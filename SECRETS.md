# SECRETS.md — Key Vault manifest

Every secret the tenant app can consume: what it does, where to get it, and
what breaks without it. Per Invariant 3: secret **values** live in Azure Key
Vault (production) or `.env.local` as `SECRET_<ref>` (local dev, via the env
provider). The database stores only the reference **name** on
`integrations.kv_secret_ref`. No endpoint, log, or error message ever returns
a value — `/api/status` reports names and a populated/not-populated boolean.

**Naming convention:** `tenant-<slug>-<integration>-key` for per-tenant
secrets, `curbside-<service>-key` for platform-wide ones. The seed script
pre-fills `kv_secret_ref` on every integration row, so `/api/status` doubles
as the "what's missing" checklist.

**Ownership (`key_owner` on the integration row, D8/CONTROL-PLANE §3):**
`client` = the key lives in the client's own vendor account (portability;
their billing). `curbside` = platform-level service on our account.

## Per-tenant secrets

| Ref pattern | Owner | What it does | Where to get it | What breaks without it |
|---|---|---|---|---|
| `tenant-<slug>-reviews-google-key` | client | Google Places API (v1) key used by the review fetch job. Row config needs `place_id`. | Google Cloud Console → the **client's** project → enable Places API (New) → credentials. Get their Place ID from the GBP listing. | Review fetch job skips Google; site keeps serving cached rows, or demo reviews if none exist. Nothing breaks on-page. |
| `tenant-<slug>-reviews-yelp-key` | client | Yelp Fusion API key for the review fetch job. Row config needs `business_id`. | biz.yelp.com → Yelp Fusion developer portal. Business ID from the Yelp page URL. | Same graceful degradation as Google reviews. |
| `tenant-<slug>-instagram-key` | client | Instagram Graph API long-lived access token for the feed fetch job. | Meta developer app + the client's Instagram Business/Creator account; exchange for a long-lived token (60-day, needs rotation — the dashboard's expiry warning covers this in Session 2). | Feed shows branded demo tiles labeled "sample feed". |
| `tenant-<slug>-payments-key` | client | Reserved for Stripe Connect (D7, deferred). Do not populate in v1. | — | Nothing; payments is a demo callout in v1 by design. |

## Platform secrets (one per environment, shared across tenants)

| Ref | What it does | Where to get it | What breaks without it |
|---|---|---|---|
| `tenant-<slug>-email-key` (points at Curbside's Resend key per tenant, or use one `curbside-resend-key` and set the same ref on every row) | Sends lead notifications and portal magic-link emails via Resend. Row config needs `from` (verified sender on the tenant's domain — SPF/DKIM per ARCHITECTURE §6). | resend.com → API keys. Domain verification per client domain in Session 4. | Emails print to the server console (demo sender). Leads still land in the DB and portal; magic-link login is console-only, which is fine in dev and an outage-degradation in prod. |
| `tenant-<slug>-newsletter-key` | Resend Audiences sync for newsletter signups. Row config needs `audience_id`. | resend.com → Audiences. | Subscribers still write to our table (source of truth); only the ESP sync no-ops. |
| `tenant-<slug>-change-request-ai-key` (Anthropic) | LLM parsing of portal change requests into typed diffs. | console.anthropic.com → API keys (Curbside's account). | Demo parser handles hours/tagline changes deterministically; everything else escalates to the ops queue. Chat keeps working. |
| `tenant-<slug>-quote-assistant-key` (Anthropic) | Live AI quote assistant (deferred — live.ts throws by design in v1). | Same Anthropic account. | Widget serves labeled demo ballparks. |
| — analytics (no secret) | Plausible needs only `config.domain` on the integration row. | plausible.io → add site. | No script tag renders; our own events table records conversions regardless (D14). |
| — call_tracking (no secret in v1) | DNI number pair in `config.dni_display` / `config.dni_tel`. | Provider (Twilio/CallRail) when the add-on sells. | Pages render the canonical NAP number. JSON-LD/llms.txt always do regardless (Invariant 6). |

## Infrastructure secrets (not integration rows)

| Name | What it does | Where it lives | What breaks without it |
|---|---|---|---|
| `DATABASE_URL` | App connection as `curbside_app` (RLS-constrained — never the owner role; db.ts refuses). | Key Vault → Container Apps secret ref (Session 4). Local: `.env.local`. | App doesn't boot. |
| `DATABASE_URL_OWNER` | Migrations/seeds only. | CI + operator laptop only. Never in the app environment. | Can't migrate; app unaffected. |
| `STAFF_STATUS_TOKEN` | Bearer token for `/api/status` until real staff auth (Session 2). | Key Vault. Local: `.env.local`. | Status endpoint 401s for everyone. |
| `APP_DB_PASSWORD` | Password migrate.ts sets on the `curbside_app` role. | Key Vault; defaults to a dev value locally. | Local default works; prod runbook overrides. |

## Operator-side keys (scripts only — never the app process)

| Env var | What it does | Where to get it | What breaks without it |
|---|---|---|---|
| `PEXELS_API_KEY` | Preferred stock-photo provider in `scripts/source-images.ts` (Part 10 sourcing workflow). | pexels.com/api — free, instant. | Scripts fall back to keyless Openverse (CC-licensed, noticeably rougher picks — budget more review time). Nothing breaks. |
| `ANTHROPIC_API_KEY` | The `--ai` flag on the sourcing script (narrative-fit search queries). | console.anthropic.com. | `--ai` unavailable; the script falls back to the manifest's stored queries. |

## Control-plane secrets (Session 2)

| Ref / env var | What it does | Where to get it | What breaks without it |
|---|---|---|---|
| `curbside-resend-api-key` (secret ref) | Platform email: intake receipts, registrar instructions, dunning warnings, staff pings (`src/lib/control/notify.ts`). Also referenced above for tenant email. | resend.com → API keys. | Console delivery — every email prints to the server log instead. Pipelines never abort on it. |
| `curbside-anthropic-api-key` (secret ref) | Content seeding (2.6): claude-opus-4-8 drafts site copy + posts in the owner's voice. | console.anthropic.com. | Deterministic template drafts (still useful, clearly generic). The consent gate applies either way. |
| `curbside-cloudflare-api-token` (secret ref) | Cloudflare for SaaS Custom Hostnames API (create/poll/delete client domains, D15). Needs `CLOUDFLARE_ZONE_ID` env alongside. | Cloudflare dash → API tokens → zone-scoped, Custom Hostnames edit (Session 4 runbook). | Demo hostname provider: simulated verification after a ~90s soak. Setting the zone id WITHOUT the token throws loudly (D11 half-configured). |
| `curbside-stripe-webhook-secret` (secret ref) | Verifies `stripe-signature` on `/api/stripe/webhook`. | Stripe dashboard → webhook endpoint → signing secret (Session 4). | Webhook falls to the DEMO provider, which only accepts simulated events (`npm run stripe:simulate`). Real Stripe events are rejected until this is populated. |
| `DATABASE_URL_CONTROL` (env) | Control-plane pool as `curbside_control` — staff surface, intake pipeline, jobs, webhooks. control/db.ts refuses any other role. | migrate.ts creates the role; password via `CONTROL_DB_PASSWORD`. | Admin, intake, jobs, and webhooks all fail to boot their queries. Tenant sites unaffected. |
| `STAFF_TOTP_ENC_KEY` (env) | AES-256-GCM key encrypting staff TOTP secrets at rest. | Any long random string locally; Key Vault in production (Session 4). | Dev fallback key with a console warning locally; production mode refuses (Invariant 3). Changing it orphans existing enrollments — staff re-enroll. |
| `CRON_TOKEN` (env) | Bearer auth for `POST /api/jobs/run` (the scheduled-jobs trigger). | Any long random string. | `npm run jobs` 401s; the dashboard's "Run checks now" (staff session) still works. |
| `STAFF_ADMIN_PASSWORD` (env, seed-time only) | Password for the first staff user created by `npm run db:seed:fleet`. | Choose one; if unset the seed prints a generated one ONCE. | Nothing at runtime — it's only read by the seed. |
| `STRIPE_PRICE_MAP` (env, not secret) | JSON map of real Stripe price ids → plan tier / feature flag / MRR (D19). | Stripe dashboard product prices (Session 4). | Demo price ids (`price_curb`, `price_addon_crm`, …) apply — correct locally, wrong against a real Stripe account. |

## Session 4 — production wiring

The Key Vault provider is live (`src/lib/secrets.ts`): set
`SECRET_PROVIDER=keyvault` + `AZURE_KEY_VAULT_NAME`, authenticated by
DefaultAzureCredential (managed identity on Container Apps, `az login` on a
laptop). Values are cached ~5 minutes, so rotation lands within that window
with no deploy. RUNBOOK.md Phase 3 provisions the vault; Phase 5.6 proves
the app reads a secret and that no endpoint returns a value.

Infrastructure secrets now held IN Key Vault and surfaced to the app as
Container Apps secret-references (never plain env values):

| KV name | Feeds env var |
|---|---|
| `curbside-app-database-url` | `DATABASE_URL` |
| `curbside-control-database-url` | `DATABASE_URL_CONTROL` |
| `staff-status-token` | `STAFF_STATUS_TOKEN` |
| `staff-totp-enc-key` | `STAFF_TOTP_ENC_KEY` |
| `cron-token` | `CRON_TOKEN` (also injected into the tick job) |

One deliberate duplicate: the edge Worker (`infra/cloudflare/`) holds its
own copy of the Resend key (`wrangler secret put RESEND_API_KEY`) for
failover alert emails — the Worker must be able to alert precisely when
the app (and its Key Vault access) is the thing that's down. Rotating the
Resend key means rotating it in **both** places.

## Rotation

Rotate by writing the new value to the same ref (Key Vault versioning keeps
history), no deploy needed — adapters resolve at call time. Instagram tokens
expire in ~60 days and are the first thing that will bite.

**Rotation policy lives on the integration row** (Session 2, CONTROL-PLANE §3):
set `secret_expires_at` (and optionally `rotation_days`) via the tenant page in
the admin, and the secret-expiry job raises a dashboard alert 30 days out —
warn BEFORE the key dies, not after. `key_owner` on the same row records whose
account the key belongs to (D8: prefer client-owned wherever the vendor allows).
