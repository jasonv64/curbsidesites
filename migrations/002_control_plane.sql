-- 002_control_plane.sql — Control plane (CONTROL-PLANE.md, Session 2)
--
-- Adds the second DB surface: curbside_control, the role the staff/control
-- code paths connect as. It is NOT the app role — curbside_app never gains
-- write access to tenants/domains and never sees staff, billing, consent, or
-- alarm tables. Both roles are NOBYPASSRLS; the control role's cross-tenant
-- reach comes from explicit permissive policies, not from bypassing RLS.
--
-- Run by scripts/migrate.ts as curbside_owner (which also creates the
-- curbside_control role before applying this file). Forward-only.

-- ---------------------------------------------------------------------------
-- Extensions to existing tables
-- ---------------------------------------------------------------------------

-- Reserved hostnames: the control plane owns admin.<apex>; a tenant slug that
-- collides with a platform surface must be impossible, not just unlikely.
ALTER TABLE tenants ADD CONSTRAINT tenants_slug_not_reserved CHECK (
  slug NOT IN ('admin','www','api','app','staff','sites','status','platform',
               'onboard','assets','cdn','mail','portal')
);

-- Intake voice field (2.2.3 fallback voice source). Deliberately NOT selected
-- into the render bundle — it is pipeline raw material, never page content.
ALTER TABLE business_profile ADD COLUMN voice_notes text;

-- Part 3: rotation policy per integration, warned BEFORE the key dies.
ALTER TABLE integrations ADD COLUMN secret_expires_at timestamptz;
ALTER TABLE integrations ADD COLUMN rotation_days int;

-- Part 2.5 / D8: registrar NAME only, per domain; provisioning state machine.
ALTER TABLE domains ADD COLUMN registrar text;
ALTER TABLE domains ADD COLUMN verification_status text NOT NULL DEFAULT 'unmanaged'
  CHECK (verification_status IN ('unmanaged','pending','verified','failed','released'));
ALTER TABLE domains ADD COLUMN instructions_sent_at timestamptz;
ALTER TABLE domains ADD COLUMN last_chased_at timestamptz;
ALTER TABLE domains ADD COLUMN released_at timestamptz;
UPDATE domains SET verification_status = 'verified' WHERE verified_at IS NOT NULL;

-- Part 8: the staff queue works escalated/urgent requests.
ALTER TABLE change_requests ADD COLUMN urgent boolean NOT NULL DEFAULT false;
ALTER TABLE change_requests ADD COLUMN staff_note text;
ALTER TABLE change_requests ADD COLUMN resolved_at timestamptz;

-- ---------------------------------------------------------------------------
-- Staff auth (D16: real auth with MFA; a different surface from owners)
-- ---------------------------------------------------------------------------

CREATE TABLE staff_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  name            text NOT NULL,
  role            text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','tech')),
  password_hash   text NOT NULL,            -- scrypt, never plaintext
  totp_secret_enc text,                     -- AES-256-GCM, key from secret provider
  totp_enabled    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

CREATE TABLE staff_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,          -- sha256 of the cookie value
  mfa_ok     boolean NOT NULL DEFAULT false,-- password-only until TOTP verifies
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Onboarding pipeline (Part 2)
-- ---------------------------------------------------------------------------

-- The audit record of what the form actually submitted. The form's OUTPUT is
-- the tenant + child rows written in the same transaction; this row is the
-- receipt, not the source of truth.
CREATE TABLE intake_submissions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payload    jsonb NOT NULL,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.2: consent state is a FIELD ON THE TENANT RECORD, not a filing cabinet.
-- One row per grant event. Active consent = granted_at set, withdrawn_at null.
CREATE TABLE consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('terms_of_service','call_recording_ai')),
  source       text NOT NULL CHECK (source IN ('intake_form','verbal_on_call','staff_recorded')),
  consent_text text NOT NULL,               -- the exact language they agreed to
  granted_at   timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  recorded_by  uuid REFERENCES staff_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_tenant_kind_idx ON consents (tenant_id, kind);

-- 2.4: the 30-minute call, auto-booked after the form.
CREATE TABLE onboarding_calls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  held_at      timestamptz,
  recorded     boolean NOT NULL DEFAULT false,
  notes        text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 2.2: transcript + recording pointer. verbal_consent is the in-recording
-- confirmation (2.2.2); the content pipeline refuses any transcript whose
-- consent chain is incomplete (2.2.4), and withdrawal deletes the row (2.2.5).
CREATE TABLE transcripts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_id        uuid REFERENCES onboarding_calls(id) ON DELETE SET NULL,
  body           text NOT NULL,
  recording_url  text,
  verbal_consent boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 2.3: the brand gate. Proposals render, then a HUMAN approves. The go-live
-- action refuses a tenant whose latest proposal is not approved.
CREATE TABLE brand_proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tokens           jsonb NOT NULL,
  font_pairing_key text NOT NULL,
  -- { source, texture_notes, do_not_do[] } — the taste memo (2.3)
  notes            jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed','approved','rejected')),
  decision_note    text,
  decided_by       uuid REFERENCES staff_users(id),
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_proposals_tenant_idx ON brand_proposals (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Billing (Part 4, D7, D19) — deferred from Session 1 (ASSUMPTIONS #22)
-- ---------------------------------------------------------------------------

CREATE TABLE billing (
  tenant_id              uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text NOT NULL DEFAULT 'none'
                         CHECK (status IN ('none','trialing','active','past_due','unpaid','canceled')),
  plan_price_id          text,
  -- add-on subscription items, mapped 1:1 to feature flags (D19)
  addons                 jsonb NOT NULL DEFAULT '[]',
  mrr_cents              int NOT NULL DEFAULT 0,
  current_period_end     timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Raw webhook receipts — idempotency + audit. stripe_event_id is unique so a
-- replayed webhook is a no-op, never a double-application.
CREATE TABLE billing_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE SET NULL,
  stripe_event_id text NOT NULL UNIQUE,
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The dunning ledger. Automation PREPARES the suspension; a person TAKES it
-- (Part 4: never let a webhook kill a business's phone line over $2).
CREATE TABLE payment_failures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_invoice_id text,
  amount_cents      int NOT NULL DEFAULT 0,
  first_failed_at   timestamptz NOT NULL DEFAULT now(),
  last_failed_at    timestamptz NOT NULL DEFAULT now(),
  retries           int NOT NULL DEFAULT 0,
  -- [{day: 3, sent_at: ...}, ...] — the day-3/7/14 warning receipts
  warnings          jsonb NOT NULL DEFAULT '[]',
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','recovered','pending_suspension','suspended','waived')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_failures_tenant_idx ON payment_failures (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Watching the fleet (Parts 5, 6) + the human gates
-- ---------------------------------------------------------------------------

-- Actions the automation prepared and a human must take. The suspension path
-- lands here; so do custom-work quotes (Part 8).
CREATE TABLE pending_actions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind       text NOT NULL,                 -- suspend_tenant | custom_quote | ...
  reason     text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','approved','dismissed')),
  created_by text NOT NULL DEFAULT 'system',
  decided_by uuid REFERENCES staff_users(id),
  decided_at timestamptz,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pending_actions_status_idx ON pending_actions (status, created_at DESC);

-- What's on fire. Jobs write these; the dashboard sorts by them; resolving is
-- a staff action. tenant_id NULL = platform-level alert.
CREATE TABLE alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL,                -- zero_form_submissions | deliverability |
                                            -- secret_expiry | domain_stuck | failover | ...
  severity    text NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','critical')),
  message     text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES staff_users(id)
);
CREATE INDEX alerts_open_idx ON alerts (created_at DESC) WHERE resolved_at IS NULL;

-- Synthetic end-to-end checks (Part 5): scheduled probes, logged per tenant.
-- ok NULL = check skipped (e.g. .test domains have no DNS to probe locally).
CREATE TABLE synthetic_checks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('form_delivery','email_deliverability')),
  ok         boolean,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX synthetic_checks_tenant_idx ON synthetic_checks (tenant_id, kind, created_at DESC);

-- Staff/system action audit. Every state-changing control-plane action logs
-- here with who did it; the change-request queue logs the original message.
CREATE TABLE audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor      text NOT NULL,                 -- staff email | 'system' | 'pipeline'
  tenant_id  uuid REFERENCES tenants(id) ON DELETE SET NULL,
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-Level Security (Invariant 2 — every tenant-scoped table, no exceptions)
-- ---------------------------------------------------------------------------

-- Tenant-scoped control tables: same isolation policy as 001. The app role
-- holds no grants on them, but the policy keeps the invariant unconditional.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'intake_submissions','consents','onboarding_calls','transcripts',
    'brand_proposals','billing','payment_failures','synthetic_checks'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_tenant_id())
         WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;

-- Platform-level control tables: visible ONLY to curbside_control. The app
-- role has no grants and no policy — staff sessions can never be read from a
-- tenant-scoped context (D16).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'staff_users','staff_sessions','billing_events','pending_actions',
    'alerts','audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY control_only ON %I TO curbside_control
         USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- The control role's cross-tenant reach: an explicit permissive policy on
-- every tenant-scoped table (fleet dashboard, onboarding pipeline, jobs).
-- This is deliberate and scoped to the role — NOT BYPASSRLS.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_profile','services','brand','sections','images','content',
    'leads','subscribers','reviews','integrations','events','change_requests',
    'magic_links','portal_sessions',
    'intake_submissions','consents','onboarding_calls','transcripts',
    'brand_proposals','billing','payment_failures','synthetic_checks'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY control_all ON %I TO curbside_control
         USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Routing tables: control plane may WRITE them (that is the whole point of
-- the onboarding pipeline — a form submission creates a tenant, no human SQL).
CREATE POLICY control_all ON tenants TO curbside_control USING (true) WITH CHECK (true);
CREATE POLICY control_all ON domains TO curbside_control USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, domains,
  business_profile, services, brand, sections, images, content,
  leads, subscribers, reviews, integrations, events, change_requests,
  magic_links, portal_sessions,
  staff_users, staff_sessions, intake_submissions, consents, onboarding_calls,
  transcripts, brand_proposals, billing, billing_events, payment_failures,
  pending_actions, alerts, synthetic_checks, audit_log
TO curbside_control;

-- The app role gains NOTHING in this migration. In particular: still no
-- INSERT/UPDATE on tenants or domains, and no access of any kind to staff,
-- billing, consent, or alarm tables.
