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

## Rotation

Rotate by writing the new value to the same ref (Key Vault versioning keeps
history), no deploy needed — adapters resolve at call time. Instagram tokens
expire in ~60 days and are the first thing that will bite; the fleet
dashboard's expiry warnings (CONTROL-PLANE §3, Session 2) exist for exactly
this.
