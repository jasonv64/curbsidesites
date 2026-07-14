-- 001_init.sql — Tenant app schema + Row-Level Security (ARCHITECTURE D4, §4)
--
-- Run as curbside_owner (migrations only). The app connects as curbside_app,
-- which CANNOT bypass RLS. Tenant context is set per transaction with
-- SET LOCAL app.tenant_id (via set_config(..., true)) — never session-level SET.
--
-- Forward-only. Never edit a shipped migration; add a new one.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  business_name text NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','suspended')),
  plan_tier     text NOT NULL DEFAULT 'curb' CHECK (plan_tier IN ('curb','curb_plus','curb_pro')),
  -- D19: every tier and add-on is a feature flag on the tenant record.
  features      jsonb NOT NULL DEFAULT '{}',
  owner_email   text,
  preview_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE domains (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hostname       text NOT NULL UNIQUE,
  is_primary     boolean NOT NULL DEFAULT false,
  cf_hostname_id text,
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX domains_tenant_idx ON domains (tenant_id);

CREATE TABLE business_profile (
  tenant_id      uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Invariant 6: NAP has exactly one home. Everything renders from this row.
  nap            jsonb NOT NULL,
  hours          jsonb NOT NULL DEFAULT '{}',
  geo            jsonb,
  socials        jsonb NOT NULL DEFAULT '{}',
  service_area   text[] NOT NULL DEFAULT '{}',
  schema_subtype text NOT NULL DEFAULT 'LocalBusiness',
  tagline        text,
  about          text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug       text NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name       text NOT NULL,
  blurb      text NOT NULL DEFAULT '',
  body       text NOT NULL DEFAULT '',
  sort_order int  NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE brand (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Semantic tokens only (TENANT-APP Part 6): brand, brand_dark, surface,
  -- surface_raised, ink, ink_muted, edge, accent.
  tokens           jsonb NOT NULL,
  font_pairing_key text NOT NULL DEFAULT 'industrial',
  logo_url         text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page         text NOT NULL,
  section_name text NOT NULL,
  sort_order   int  NOT NULL DEFAULT 0,
  props        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX sections_tenant_page_idx ON sections (tenant_id, page, sort_order);

CREATE TABLE images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slot_id      text NOT NULL,
  purpose      text NOT NULL DEFAULT '',
  search_query text NOT NULL DEFAULT '',
  aspect       text NOT NULL DEFAULT '16:9',
  alt          text NOT NULL DEFAULT '',
  url          text,          -- NULL → branded SVG placeholder serves (Part 10)
  credit       text,
  UNIQUE (tenant_id, slot_id)
);

CREATE TABLE content (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('post','page')),
  slug         text NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  -- Typed frontmatter validated by Zod on write (D18). Dates stored as plain
  -- 'YYYY-MM-DD' strings; rendering pins them to noon (timezone trap).
  frontmatter  jsonb NOT NULL,
  body         text NOT NULL,
  published_at timestamptz,   -- NULL = draft, hidden in prod
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type, slug)
);

CREATE TABLE leads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  contact    jsonb NOT NULL,  -- { email?, phone?, preferred }
  service    text,
  vehicle    text,
  message    text NOT NULL DEFAULT '',
  photo_urls text[] NOT NULL DEFAULT '{}',
  source     text NOT NULL DEFAULT 'direct',
  status     text NOT NULL DEFAULT 'new'
             CHECK (status IN ('new','contacted','quoted','won','lost')),
  notes      jsonb NOT NULL DEFAULT '[]',
  is_demo    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_tenant_created_idx ON leads (tenant_id, created_at DESC);

CREATE TABLE subscribers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email      text NOT NULL,
  is_demo    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source       text NOT NULL CHECK (source IN ('google','yelp')),
  external_id  text,
  author       text NOT NULL,
  rating       numeric(2,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body         text NOT NULL DEFAULT '',
  review_url   text,
  published_at timestamptz,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  is_demo      boolean NOT NULL DEFAULT false
);
CREATE INDEX reviews_tenant_idx ON reviews (tenant_id, is_demo, published_at DESC);

CREATE TABLE integrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key           text NOT NULL,
  mode          text NOT NULL DEFAULT 'demo' CHECK (mode IN ('live','demo')),
  -- Non-secret config only (place IDs, site domains). Secret VALUES live in
  -- Key Vault; this row stores only the reference name (Invariant 3).
  config        jsonb NOT NULL DEFAULT '{}',
  kv_secret_ref text,
  key_owner     text NOT NULL DEFAULT 'curbside' CHECK (key_owner IN ('client','curbside')),
  last_error_at timestamptz,
  last_error    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_tenant_type_idx ON events (tenant_id, type, created_at DESC);

CREATE TABLE change_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  raw_message  text NOT NULL,
  parsed_diff  jsonb,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','confirmed','applied','rejected','escalated')),
  confirmed_at timestamptz,
  applied_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_requests_tenant_idx ON change_requests (tenant_id, created_at DESC);

-- Portal auth (D16: owner = magic link, scoped to exactly one tenant)
CREATE TABLE magic_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email      text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE portal_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email      text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Row-Level Security (D4, Invariant 2)
--
-- Every tenant-scoped table gets ENABLE + FORCE RLS and a policy that compares
-- tenant_id to the transaction-local app.tenant_id. current_setting(..., true)
-- returns NULL when unset; NULL never equals anything, so no context = 0 rows.
--
-- tenants + domains are the two routing tables the app must read BEFORE a
-- tenant context exists (Host header resolution). They are readable by the
-- app role but not writable. They contain no customer PII.
-- ---------------------------------------------------------------------------

CREATE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_read_for_routing ON tenants FOR SELECT USING (true);

ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains FORCE ROW LEVEL SECURITY;
CREATE POLICY domains_read_for_routing ON domains FOR SELECT USING (true);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_profile','services','brand','sections','images','content',
    'leads','subscribers','reviews','integrations','events','change_requests',
    'magic_links','portal_sessions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_tenant_id())
         WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Grants for the app role. No CREATE, no ALTER, no BYPASSRLS — if this role is
-- ever granted BYPASSRLS the platform's core safety property is gone.
-- ---------------------------------------------------------------------------

GRANT SELECT ON tenants, domains TO curbside_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  business_profile, services, brand, sections, images, content,
  leads, subscribers, reviews, integrations, events, change_requests,
  magic_links, portal_sessions
TO curbside_app;
