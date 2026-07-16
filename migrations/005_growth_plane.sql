-- 005_growth_plane.sql — Growth plane (GROWTH-PLANE.md, Session 3)
--
-- The product is the monthly report (Part 5); everything else here is the
-- instrumentation that feeds it. Written by curbside_control (jobs, admin);
-- the app role gains exactly one thing: SELECT on reports, so the client
-- portal can render them. Same RLS discipline as 001/002.

-- ---------------------------------------------------------------------------
-- Extensions to existing tables
-- ---------------------------------------------------------------------------

-- Demo conversion events for the sample report (D5: demo rows are flagged,
-- never mixed). Real beacons/actions always write is_demo = false.
ALTER TABLE events ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- Growth-plane integration rows for tenants that predate them. New tenants
-- get these from the onboarding pipeline (INTEGRATION_KEYS).
INSERT INTO integrations (tenant_id, key, mode, kv_secret_ref, key_owner)
SELECT t.id, k.key, 'demo', 'tenant-' || t.slug || '-' || replace(k.key, '_', '-') || '-key', k.owner
  FROM tenants t
 CROSS JOIN (VALUES ('gbp', 'client'), ('rank_tracking', 'curbside')) AS k(key, owner)
 ON CONFLICT (tenant_id, key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Part 5: the monthly report — one artifact, two jobs (retention + exit, D20)
-- ---------------------------------------------------------------------------

-- data is FROZEN at generation: a report the client already read must never
-- quietly change under them. Rendering (portal HTML, PDF) derives from data.
CREATE TABLE reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('monthly','exit','sample')),
  period_start date NOT NULL,   -- first day of the month (exit: engagement start)
  period_end   date NOT NULL,   -- exclusive
  data         jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  sent_to      text,
  pdf_path     text,            -- .data/reports/... locally; Blob URL in S4
  UNIQUE (tenant_id, kind, period_start)
);
CREATE INDEX reports_tenant_idx ON reports (tenant_id, period_start DESC);

-- Staff's two lines for the report before it sends: why the month looked the
-- way it did (if we know) and what's planned next month. NULL = the generator
-- writes an honest default; it never invents an explanation.
CREATE TABLE report_notes (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  why_note   text,
  next_note  text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The scheduler (Parts 2, 9.3): staggered, quota-aware, per tenant per job
-- ---------------------------------------------------------------------------

CREATE TABLE growth_schedule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job           text NOT NULL CHECK (job IN (
                  'reviews_fetch','rank_tracking','nap_drift',
                  'review_solicitation','content_calendar','monthly_report')),
  next_run_at   timestamptz NOT NULL DEFAULT now(),
  last_run_at   timestamptz,
  last_status   text,           -- ok | failed | deferred_quota | skipped
  last_detail   jsonb NOT NULL DEFAULT '{}',
  backoff_level int NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job)
);
CREATE INDEX growth_schedule_due_idx ON growth_schedule (next_run_at);

-- Platform-level vendor quota ledger, one row per vendor per UTC day. The
-- scheduler DEFERS work rather than burning a batch into a 429 wall.
CREATE TABLE vendor_quotas (
  vendor text NOT NULL,          -- google_places | yelp | rank_vendor | gbp
  day    date NOT NULL,
  used   int NOT NULL DEFAULT 0,
  PRIMARY KEY (vendor, day)
);

-- ---------------------------------------------------------------------------
-- Part 8: rank tracking — modest by design (code caps terms per tenant)
-- ---------------------------------------------------------------------------

CREATE TABLE tracked_terms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  term       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (tenant_id, term)
);

CREATE TABLE rank_snapshots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  term_id    uuid NOT NULL REFERENCES tracked_terms(id) ON DELETE CASCADE,
  position   int,               -- NULL = not found in the checked depth
  checked_on date NOT NULL DEFAULT CURRENT_DATE,
  is_demo    boolean NOT NULL DEFAULT false,
  UNIQUE (term_id, checked_on)
);
CREATE INDEX rank_snapshots_tenant_idx ON rank_snapshots (tenant_id, checked_on DESC);

-- ---------------------------------------------------------------------------
-- Part 7: NAP drift monitor + review solicitation
-- ---------------------------------------------------------------------------

-- Drift is silent and costs rankings without producing an error. One row per
-- surface per check; mismatches also raise an alert.
CREATE TABLE nap_checks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  surface    text NOT NULL,     -- site_jsonld | site_llms_txt | gbp | yelp | ...
  ok         boolean,           -- NULL = surface unavailable (demo/live-gated)
  expected   jsonb NOT NULL,
  observed   jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nap_checks_tenant_idx ON nap_checks (tenant_id, checked_at DESC);

-- One ask per won lead, at the right moment (a few days after the win), only
-- on plans that include solicitation. lead_id UNIQUE = never nag twice.
CREATE TABLE review_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id       uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  channel       text NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  scheduled_for date NOT NULL,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_requests_due_idx ON review_requests (scheduled_for) WHERE sent_at IS NULL;

-- ---------------------------------------------------------------------------
-- Row-Level Security (Invariant 2 — every tenant-scoped table, no exceptions)
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reports','report_notes','growth_schedule','tracked_terms',
    'rank_snapshots','nap_checks','review_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_tenant_id())
         WITH CHECK (tenant_id = current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY control_all ON %I TO curbside_control
         USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- vendor_quotas is platform-level: control only, no tenant scope.
ALTER TABLE vendor_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_quotas FORCE ROW LEVEL SECURITY;
CREATE POLICY control_only ON vendor_quotas TO curbside_control
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON
  reports, report_notes, growth_schedule, vendor_quotas,
  tracked_terms, rank_snapshots, nap_checks, review_requests
TO curbside_control;

-- The app role's ONLY growth-plane grant: the portal reads reports.
GRANT SELECT ON reports TO curbside_app;
