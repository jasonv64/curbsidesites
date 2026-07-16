# Curbside Sites — Tenant App + Control Plane + Growth Plane

One Next.js application that renders **any** Curbside Sites client from a
database record, plus the control plane that turns a prospect into a live
tenant and keeps the fleet observable, plus the growth plane that produces
the evidence the retainer is worth paying — one monthly report a client
trusts, and the instrumentation feeding it. One codebase, N tenants, zero
per-client code in core — that rule (D1) governs everything; the full
decision record lives in `../ARCHITECTURE.md` (D1–D20 + invariants). This
repo now covers Sessions 1 (tenant app), 2 (control plane), 3 (growth
plane) **and 4 (production)** of the build plan in `../00-BUILD-PROMPT.md`.

This README is the handoff document: you should be able to continue from
this file alone.

**Going to production?** That's `RUNBOOK.md` — the ordered, executable path
from this local setup to live tenants on Azure + Cloudflare, with `COSTS.md`
(what it costs at 3/50/200 tenants) and `CALENDAR.md` (the real-world waits
to start on day one). Session 4 also wired the production seams: Key Vault
secret provider, Azure Blob uploads, the edge Worker
(`infra/cloudflare/`), the `Dockerfile`, and the failover snapshot pipeline.

---

## Quickstart

Prereqs: Node 20.9+ (built on 24), Docker, npm.

```bash
# 1. Postgres (container name: curbside-postgres)
docker compose up -d

# 2. Env — the committed example matches the compose file exactly
cp .env.example .env.local   # then set ALLOW_ENV_SECRETS=1 for local prod-mode runs

# 3. Schema + roles (runs as curbside_owner; creates the RLS-bound curbside_app role)
npm install
npm run db:migrate

# 4. Two realistic demo tenants
npm run db:seed

# 5. The control-plane demo fleet (4 more tenants in mixed states) + the
#    first staff user (prints the login; MFA enrolls on first sign-in)
npm run db:seed:fleet

# 6. Growth-plane demo data: 3 months of flagged demo conversions, rank
#    history, NAP checks, and the SAMPLE monthly report (HTML + PDF under
#    .data/reports/<slug>/) — the artifact you hand a prospect
npm run db:seed:growth

# 7. Run it
npm run dev        # or: npm run build && npm start
```

Then browse — all of these are the same running server:

- http://iron-ridge-offroad.localhost:3000 — off-road shop, dark industrial brand
- http://delta-marine-service.localhost:3000 — boat service, light nautical brand
- **http://admin.localhost:3000** — the staff control plane (fleet dashboard, queue, alerts)
- **http://localhost:3000/onboard** — the public intake form (a submission = a browsable draft tenant)

Custom-domain routing is testable without DNS: `curl -H "Host: ironridgeoffroad.test" http://127.0.0.1:3000/`.

Full verification (build + RLS gate + smoke + axe + control-plane e2e): `npm run verify`.

---

## How tenancy works (read this once)

```
request → src/proxy.ts (rewrites Host into the path: /s/<host>/<path>)
        → src/app/s/[host]/layout.tsx
            → getTenantBundle(host)            src/lib/tenant.ts
                → resolveHost(host)            fresh every request:
                     platform subdomain (<slug>.$PLATFORM_APEX) → tenants by slug
                     custom domain → domains table (draft tenants never resolve here)
                     unknown → null → clean 404
                → loadBundle(tenantId)         cached 600s, tag `tenant:<slug>`
            → status gate: live | draft (preview cookie) | suspended (D20 page)
            → inject brand <style> + JSON-LD + header/footer/call bar
        → page renders sections from the tenant's `sections` rows
```

Two things are deliberate and easy to break by "optimizing":

- **The tenant row (status, preview_token, features) is re-read every
  request**; only the content bundle is cached. Suspending a tenant takes
  effect on the next request. Don't move status into the cached bundle.
- **All tenant DB access goes through `withTenant(tenantId, fn)`**
  (`src/lib/db.ts`), which opens a transaction and sets
  `app.tenant_id` via `set_config(..., is_local=true)` — the parameterized
  form of `SET LOCAL`. There is no exported way to get a raw client. Keep it
  that way; it's what makes RLS (D4) enforce isolation even against buggy
  queries. The proof lives in `tests/rls-isolation.test.ts` and CI fails if
  that file disappears.

### Demo vs. live (D11) — the table

| Feature | Required config (integrations row) | Live behavior | Fallback behavior |
|---|---|---|---|
| Reviews | `reviews_google`: config.place_id + secret; `reviews_yelp`: config.business_id + secret; then run `npm run fetch:reviews <slug>` | Cached real rows render; aggregateRating JSON-LD emits | Seeded demo rows + "sample reviews" label; **no** aggregateRating (Inv. 7) |
| Instagram | `instagram`: secret (Graph token); run `npm run fetch:instagram <slug>` | Cached real posts | Branded demo tiles + "sample feed" label |
| Analytics | `analytics`: config.domain (no secret) | Plausible script tag renders | No script; our `events` table records conversions either way (D14) |
| Email (lead notify + magic links) | `email`: config.from + secret (Resend) | Real delivery | Console-printed email; lead is in the DB regardless |
| Newsletter ESP sync | `newsletter`: config.audience_id + secret | Resend Audience sync | Row in `subscribers` only (our table is the source of truth) |
| Change-request AI | `change_request_ai`: secret (Anthropic) | LLM → typed diff → client confirms | Deterministic parser for hours/tagline; everything else escalates |
| Payments | — (deferred, D7) | live.ts **throws by design** | Friendly "call the shop" callout; never fake success |
| Booking | — (deferred) | live.ts **throws by design** | Sample slots computed from real hours; picks funnel to the quote form |
| Quote assistant | — (deferred) | live.ts **throws by design** | Canned, clearly-labeled ballparks |
| Call tracking (DNI) | `call_tracking`: config.dni_display + dni_tel | Tracking number in **rendered pages only** | Canonical NAP number; JSON-LD/llms.txt use canonical **always** (Inv. 6) |

The selection state machine is one file: `src/lib/adapters/select.ts`.
Mode=live with missing config/secret **throws naming the fix** (half-configured
is worse than unconfigured); live call failing at runtime falls back to demo,
logs once, and stamps `last_error_at` on the row. `GET /api/status` (Bearer
`STAFF_STATUS_TOKEN`) is the fleet-wide go-live checklist: modes, config keys,
secret **names** and whether they resolve — never values.

---

## The control plane (Session 2) — read this once

**Two database roles, two surfaces, never conflated (D16).** The tenant app
connects as `curbside_app` (read-only on tenants/domains, blind to staff,
billing, consent, and alarm tables). Everything under `/admin`, `/platform`,
`/api/stripe`, and `/api/jobs` connects as `curbside_control`
(`src/lib/control/db.ts` — the ONLY file touching that pool), whose
cross-tenant reach is explicit RLS policies, not BYPASSRLS. Never import
`control/db` from anything under `src/app/s/[host]`.

**Hosts:** `admin.<apex>` → the staff surface (password + TOTP, enrollment
forced at first login). Bare apex → `/platform`, the one public control-plane
surface: the intake form. Both are reserved slugs at the DB level.

### The onboarding pipeline, end to end

1. **Prospect submits `/onboard`** (Part 2.1). The form's output is DATABASE
   ROWS, written in one `curbside_control` transaction
   (`src/lib/control/onboarding.ts`): a `draft` tenant, business_profile
   (NAP/hours/socials/voice), services, a brand row carrying the GENERATED
   proposal tokens (so the draft renders instantly), the image-slot manifest,
   all 11 integration rows (demo mode, kv refs pre-named), consents rows with
   the exact language agreed to, the auto-booked call, and the intake receipt.
   The add-on checkboxes ARE the feature flags (D19). Zero human DB access.
2. **The success page and receipt email carry the preview link** —
   `http://<slug>.<apex>/?preview=<token>`, the sales artifact (2.5).
3. **The brand gate (2.3), the one human gate:** admin → tenant → Brand gate
   shows swatches, the contrast report (same math as CI), texture notes, and
   the do-not-do list. LOOK AT THE PREVIEW, then approve (writes tokens to
   the live brand row) or reject with a note. Never automate this.
4. **The call (2.4)** under the consent regime (2.2): the recording checkbox
   at intake is a distinct consent stored verbatim; no written consent → the
   call proceeds UNRECORDED and the transcript upload REFUSES. Verbal consent
   must also be confirmed in-recording before a transcript is usable.
   Withdrawal (one button) deletes recording + transcript.
5. **Content seeding (2.6):** admin → tenant → Seed content. Voice source =
   consented transcript, else the intake voice field; an unconsented
   transcript is a hard refusal in your face (2.2.4). Drafts land UNPUBLISHED;
   publish per-post after reading them.
6. **Domain (2.5, D8):** admin → tenant → Domains → provision. Creates the
   Cloudflare custom hostname (demo provider simulates until Session 4),
   emails REGISTRAR-SPECIFIC record instructions, polls on every jobs run,
   chases the client automatically every 3 quiet days, notifies both sides on
   verification — and flips `draft → live` when the brand gate has passed.
   Staff can force platform-subdomain-only go-live from the tenant page.

### Watching the fleet

- **`npm run jobs`** (or POST `/api/jobs/run`, or the dashboard's "Run checks
  now") runs: domain verification + chase, dunning, the zero-submissions
  alarm (14 quiet days on a tenant with a baseline — the churn detector,
  Part 5), a synthetic end-to-end form check per live tenant (insert →
  right-tenant check → owner email → delete → logged), SPF/DKIM/DMARC checks
  per verified domain, and secret-expiry warnings. Findings land as `alerts`
  rows; the dashboard sorts by what's on fire.
- **Billing (Part 4):** Stripe webhooks (`/api/stripe/webhook`,
  signature-verified, idempotent by event id) sync subscription state to
  `billing`, `tenants.plan_tier`, and feature flags — buying an add-on flips
  a flag, no provisioning step. Failed payments start the day-3/7/14 warning
  ladder; day 14 PREPARES a suspension in the queue. **No code path suspends
  automatically.** Local simulation:
  `npm run stripe:simulate -- <slug> subscribe curb_plus crm` ·
  `npm run stripe:simulate -- <slug> payment_failed --days-ago 15` then
  `npm run jobs` · `npm run stripe:simulate -- <slug> paid`.

### Control-plane recipes

- **Onboard a tenant:** fill the form at `/onboard`. That's the recipe — if
  you're inserting rows by hand for a real client, the pipeline is broken;
  fix it instead (`scripts/seed.ts` remains the fixture reference).
- **Provision a domain:** tenant page → Domains → enter the bare domain →
  button. Instructions email themselves; verification and go-live are
  automatic from there. Stalled clients get chased without you remembering.
- **Rotate a secret:** write the new value to the same ref (vault/env), then
  set `secret_expires_at`/`rotation_days` on the integration row (tenant page
  shows expiry; the job warns 30 days out). Values never enter the DB.
- **Suspend / restore:** tenant page buttons (status flips take effect next
  request; the e2e proves under-construction-everywhere and intact
  restoration). Non-payment suspensions arrive pre-built in the Queue —
  approve or dismiss, never rubber-stamp.
- **Offboard:** tenant page → Offboard (type the slug). Runs the full D20
  sequence: suspend → exit export (`.data/exports/<slug>/` — JSON for the
  Session-3 report renderer + a leads CSV a human can open) → release
  domains + handback email → integrations to demo + vault purge manifest →
  transcripts hard-deleted. Gracious on purpose.
- **Work the queue:** `/queue` holds pending human actions (suspensions,
  custom-work quotes) and escalated/urgent change requests with the original
  message as the audit record (Part 8).

## The growth plane (Session 3) — read this once

**The product is the monthly report** (`GROWTH-PLANE.md` Part 5); everything
else in `src/lib/growth/` is instrumentation feeding it. It leads with one
number — how many people tried to contact you this month — sourced from the
leads table (form submissions, server truth) plus call_tap/map_tap events.

### How the report is assembled

`assembleReport()` (`src/lib/growth/report.ts`) queries a frozen snapshot of
contacts (+breakdown by type/source), month-over-month and year-over-year
trend, reviews (count/rating/movement), search-visibility movement on tracked
terms, "what Curbside shipped" (published posts, applied change requests,
health checks, NAP verifications), the staff `report_notes` (why/next — the
generator never invents an explanation), and honest `data_gaps`. The result
is FROZEN into `reports.data`; `renderReportHtml()` renders that same object
in the portal (`/portal/reports`), as the emailed summary, and as the PDF
(Playwright chromium, best-effort — absent chromium is logged, never faked).
**A sent report is immutable**; regeneration is refused. Sample reports
(kind='sample') read `is_demo` rows only, carry a demonstration band, and
are never emailed. Exit reports (D20) are the same artifact with the numbers
ending, generated by offboarding into the export dir.

Reading order for the honesty rules (Invariant 12): a section with no data
says "not tracked yet" (never zeros-as-achievements); a down month states the
decline in the first breath; staff notes are relayed verbatim or replaced by
an honest default. All of it is unit-tested in `tests/growth-scheduler.test.ts`.

### How jobs are scheduled

`runGrowthJobs()` (`src/lib/growth/jobs.ts`) runs on every jobs tick (it's a
line in `runAllJobs`). Per tenant × job, `growth_schedule` holds the next
slot; the decision math is pure and lives in `src/lib/growth/scheduler.ts`:

- **Stagger** — a deterministic hash of tenant+job places each tenant in an
  epoch-anchored window (reviews 14d, ranks/NAP 7d, solicitation daily,
  content/report month-anchored to the 1st/2nd ± 4 days). 200 tenants never
  hit Yelp in the same hour, and a fresh fleet's first runs land in future
  slots — no thundering herd.
- **Quota** — `vendor_quotas` tracks per-vendor UTC-day budgets
  (`QUOTA_<VENDOR>_PER_DAY` to override; defaults leave headroom under free
  tiers). A spent budget DEFERS the job 6h: no error, no backoff, cached rows
  keep serving, other tenants unaffected.
- **Backoff** — real failures retry at 30min·2^n (cap 24h) and stamp
  `last_error_at` on the integration row. Consent refusals and
  half-configured LIVE integrations alert immediately (operator problems);
  transient failures alert on the third consecutive miss.

### How to add a metric to the report

1. Add the query to `assembleReport()` and the field to `ReportData` —
   include an `available`/null state for tenants that don't have it yet.
2. Render it in `renderReportHtml()` with an explicit "not tracked yet"
   branch. Never render a zero as an achievement.
3. Add an honesty unit test in `tests/growth-scheduler.test.ts` (what does it
   say when the data is missing?) and re-run `npm run db:seed:growth` to eye
   the sample. The axe suite audits the report artifact too.
Old reports don't change — their data is frozen; the new metric appears from
the next generation on. That's a feature.

### Growth gotchas

- **Monthly boundaries are America/Los_Angeles** (`src/lib/growth/period.ts`).
  `new Date(Date.UTC(y,m,1))` misfiles every LA-evening conversion from the
  31st; `tzMidnight()` exists so nobody re-derives this. DST-tested.
- **A partial-data month degrades honestly, not silently:** sections report
  `available:false`, gaps are stated in client language, and a real-data
  report for a tenant with zero traffic says 0 — that's the truth, and the
  verification left one such report on iron-ridge deliberately.
- **Quota exhaustion is not an error.** If `last_status` says
  `deferred_quota`, nothing is broken — the budget refills on the next UTC
  vendor-day. Only `failed` rows with climbing `backoff_level` need a human.
- **Demo rank snapshots feed sample reports only.** Live mode of
  `rank_tracking` throws until a SERP vendor is picked (ASSUMPTIONS #64) —
  that throw naming the seam is deliberate (D11), not a bug.
- **`reports.data` is the contract.** The renderer, portal, email, and PDF
  all read it; if you change `ReportData`, old frozen rows still render (add
  optional fields, don't repurpose existing ones).

## Directory map (★ = the files you'll edit most)

```
migrations/            forward-only SQL; 001 tenant app, 002-004 control plane,
                       005 growth plane (reports, schedule, quotas, terms, NAP, asks)
scripts/               migrate, seed, seed-fleet, seed-growth, generate-report,
                       run-jobs, simulate-stripe, export-static (D6),
                       fetch-reviews, fetch-instagram, source-images
src/
  proxy.ts             Host → /s/<host>/ rewrite + admin./apex control hosts
  lib/
    control/         ★ THE CONTROL PLANE — db (control pool), staff-auth, totp,
                       intake-schema, onboarding, brand-proposal, domains,
                       billing, content-seeding, offboarding, jobs, fleet, notify
    growth/          ★ THE GROWTH PLANE — report (assembler), report-html
                       (renderer), report-run (freeze/PDF/send), period (LA
                       months), scheduler (stagger/quota/backoff), jobs
                       (dispatcher), reviews-job, rank-tracking, nap-drift,
                       solicitation, content-calendar
    db.ts              withTenant / platformQuery — THE ONLY app-pool access
    tenant.ts        ★ host resolution + cached tenant bundle + tenantTag
    schemas.ts       ★ every Zod schema and row type (single source of shape)
    section-registry.tsx ★ name → component + props schema; DEFAULT_SECTIONS
    brand.ts           token validation, contrast math, injected <style>
    fonts.ts           next/font loaders (ONLY imported by root layout)
    font-pairings.ts ★ pairing key → CSS vars (importable anywhere)
    seo.ts             JSON-LD builders, llms.txt, meta description
    content.ts         post reads + Zod-validated upsert (D18)
    portal-auth.ts     magic links + sessions (hashed tokens)
    adapters/        ★ one directory per integration: types/live/demo/index
    secrets.ts, blob.ts, events.ts, hours.ts, dates.ts, rate-limit.ts, placeholder.ts
  components/
    sections/          everything the registry renders
    site/              header, footer, sticky call bar, under-construction
    forms/, portal/, tenant-image.tsx, markdown.tsx, track.tsx
  app/
    layout.tsx         fonts only; app/page.tsx 404s (proxy owns routing)
    admin/             staff surface: login (+MFA), (app)/ fleet dashboard,
                       tenants/[slug] (brand gate, consent, domains, billing,
                       content), queue, alerts, actions.ts (all staff mutations)
    platform/          public surface on the bare apex: landing stub + /onboard
    api/status/        staff go-live checklist (not host-scoped)
    api/stripe/webhook/  billing ingest (signature-verified, idempotent)
    api/jobs/run/      the scheduled-jobs trigger (CRON_TOKEN or staff session)
    s/[host]/          the entire tenant surface:
      layout.tsx       status gates, brand injection, JSON-LD, chrome
      page.tsx, services/, about/, gallery/, contact/, blog/, privacy/ terms/ accessibility/
      actions.ts       lead + newsletter server actions
      sitemap.xml/ robots.txt/ llms.txt/ feed.xml/ og/ favicon.svg/ site.webmanifest/
      placeholder/[slot]/  branded SVG placeholders (nothing ever 404s)
      uploads/[...path]/   local-dev blob serving (tenant-scoped)
      api/track/       conversion beacons     api/quote-assistant/  chat stub
      portal/          magic-link portal: leads, content, settings, chat
tests/
  rls-isolation.test.ts  THE D4 gate (vitest, real DB, app role)
  e2e/                   smoke, tenant-lifecycle (D11/D20), axe (D12)
```

## Where every visual token lives

- **Values:** the tenant's `brand.tokens` row (eight semantic tokens:
  `brand, brand_dark, surface, surface_raised, ink, ink_muted, edge, accent`).
- **Derived:** `--on-brand`, `--on-brand-dark`, `--on-accent` are computed
  (white/near-black by contrast) in `src/lib/brand.ts → brandStyle()`.
- **Injection:** one `<style>` block per request in `s/[host]/layout.tsx`.
- **Utilities:** `globals.css` `@theme inline` maps them to Tailwind
  (`bg-brand`, `text-ink-muted`, `border-edge`, `font-display`…). The default
  Tailwind palette is disabled — **no raw hex in components, ever.**
- **Type:** `--font-display`/`--font-body` resolve through the pairing key
  (`brand.font_pairing_key` → `font-pairings.ts`). Fonts load at build time
  in `fonts.ts`; the DB picks a **key**, never a font name.

## Recipes

**Onboard a tenant (until the control plane exists):** insert rows —
`tenants` (slug, business_name, status, plan_tier, features, owner_email),
`business_profile`, `brand`, `services`, `images` (slot manifest; leave url
NULL for branded placeholders), optional `sections` (omit → sensible default
composition renders). Platform subdomain works the moment the tenants row
exists. `scripts/seed.ts` is the reference implementation of exactly this.

**Publish a post:** portal → Posts → New post (owner), or insert into
`content` with Zod-shaped frontmatter `{title, description, date:
"YYYY-MM-DD", author, tags[]}` and `published_at`. Publishing is a DB write +
tag revalidation — never a deploy (D18). Direct SQL writes should be followed
by `revalidateTag('tenant:<slug>', 'max')` or just wait ≤10 min.

**Change hours:** portal → Hours & services, or the chat ("make Saturday
8–2" → typed diff → owner confirms). Both paths `updateTag` the tenant.

**Add a service:** one `services` row (portal or SQL). It propagates to the
services page, home grid, footer, quote-form dropdown, sitemap, JSON-LD and
llms.txt with zero other edits — that's D2 working. If it doesn't propagate
somewhere, that somewhere has a hardcode and it's a bug.

**Swap a photo:** set `images.url` for the slot (upload to blob/`.data/uploads`
or any allowed remote). Same slot id = zero code edits. NULL url = branded
placeholder again.

**Source stock images for a demo site (Part 10 workflow):**
```bash
npm run images:source <slug> -- --ai     # Claude tunes queries to the tenant's narrative, provider fetches candidates
# → open .data/image-candidates/<slug>/review.html and LOOK at every image
npm run images:source <slug> -- --apply hero=2 gallery-1=3   # apply the winners
npm run images:source <slug> -- --auto   # demo bootstrap: apply top pick per slot, review AFTER
```
Provider: Pexels when `PEXELS_API_KEY` is set (better quality), otherwise
keyless **Openverse** (CC-licensed; the gallery page renders the required
attributions from `images.credit`). `ANTHROPIC_API_KEY` enables `--ai`. See
SECRETS.md. **`db:seed` runs `--auto` for both demo tenants automatically**
(skipped in CI or with `SKIP_IMAGE_SOURCING=1`; candidates cache under
`.data/image-candidates/` so re-seeds are offline-safe and keep reviewed
picks). The human review gate is deliberate: expect to reject a third to
half (wrong region, competitor branding, wrong subject class) — with
Openverse, expect worse; `--auto` is for local demos only and every image
still needs the review.html pass before go-live. Winners are saved as
`<slot>.jpg` so the client's own photo can later replace them under the
same name.

**Add a font pairing:** loader in `src/lib/fonts.ts` + entry in
`src/lib/font-pairings.ts`. One core change, every tenant can use it (D17-shaped).

**Add a section:** component in `src/components/sections/` taking
`{data, props}` + one registry entry (component + Zod props schema). Must be
safe with empty data. Then any tenant can declare it in `sections` rows.

**Add a custom per-tenant section (D17):** `clients/<slug>/sections/*`,
registered under `custom/<slug>/<name>`. An override may NEVER require a core
change — if it would, it's a core feature flag instead. (No custom sections
exist yet; the namespace is reserved in the registry docs.)

## Go-live runbook per integration (priority order)

1. **Email** — verify the sending domain in Resend (SPF/DKIM — Session 4
   scripts this), set `config.from`, populate the secret, flip `mode='live'`.
   Test: submit the form, confirm the owner email is **delivered**. This one
   is first because a silent lead-notification failure is the churn machine
   (CONTROL-PLANE Part 5).
2. **Analytics** — set `config.domain`, flip live. Test: script tag in HTML.
3. **Reviews** — client-owned Google/Yelp keys per SECRETS.md, place/business
   ids in config, flip live, `npm run fetch:reviews <slug>`. Test: real
   reviews render, aggregateRating appears in JSON-LD.
4. **Instagram** — token per SECRETS.md, flip live, `npm run fetch:instagram
   <slug>`. Mind the 60-day token expiry.
5. **Change-request AI** — Anthropic key, flip live. Demo parser keeps
   working as the fallback.
6. Everything else is deferred by design (payments/booking/quote-assistant
   live modes throw with instructions).

After any direct-SQL config change: `revalidateTag('tenant:<slug>', 'max')`
from a server action, or wait out the 600s window. `/api/status` never lies —
it reads the DB directly.

## What to build next (each stub's exact seam)

- **Payments** → `src/lib/adapters/payments/live.ts` (Stripe Connect
  Standard per D7; the callout component already handles both presentations).
- **Booking** → `src/lib/adapters/booking/live.ts` (inventory + confirm;
  `BookingSlotLink` already records `booking_started`).
- **Quote assistant** → `src/lib/adapters/quote-assistant/live.ts`
  (Anthropic + per-tenant price book; route/widget/rate-limit exist).
- **Call tracking** → provider provisioning writing `config.dni_*`;
  `getDisplayNumber` is the only consumer. NAP invariant is tested.
- **SMS channel for change requests** → implement `sms.ts` against
  `ChangeParser`/channel types in `src/lib/adapters/change-requests/types.ts`.
  Blocked on A2P 10DLC (ARCHITECTURE §6) — start registration early.
- **Customer portal shell** (cut in Session 1, see ASSUMPTIONS #24).
- ~~Static failover upload + serving~~ **DONE in Session 4**:
  `scripts/upload-snapshots.ts` uploads hostname-keyed snapshots to Blob;
  the edge Worker (`infra/cloudflare/worker.js`) serves them on origin
  failure and emails staff. Remaining nicety: also write an `alerts` row
  with kind `failover` when the app comes back (the dashboard seam exists).
- **Rank tracking live mode** → pick a SERP vendor (record it in
  ASSUMPTIONS.md per D3), implement `fetchLiveRanks()` in
  `src/lib/growth/rank-tracking.ts`, store the key at the integration's
  `kv_secret_ref`. Live mode currently throws naming exactly this.
- **GBP live reads** → OAuth refresh-token plumbing for the manager grant;
  `src/lib/adapters/gbp/live.ts` takes the ready bearer. Then posts/Q&A/
  hours-sync build on the same client. (Not wired in Session 4 — it needs a
  real client's GBP grant to test against; the seam is unchanged.)
- ~~Report PDF in production~~ **DONE in Session 4**: the `Dockerfile`
  bakes Playwright chromium into the app image; PDFs render in-process.
- **Real call scheduling** → replace `nextCallSlot()` in
  `src/lib/control/onboarding.ts` with a Cal.com/Calendly integration; the
  `onboarding_calls` row is the contract.
- **CWV column on the dashboard** → needs RUM (Session 4); the column and its
  honest "n/a" placeholder are in `src/app/admin/(app)/page.tsx`.

## Conventions to preserve

- `withTenant` (app role) under `/s/[host]`; `control/db.ts` (control role)
  everywhere staff-side. Neither crosses over — the roles make it stick.
- Every staff mutation: `requireStaff()` first, `audit()` with the email,
  `refreshAdmin()` last. Actions that can refuse return a message, not a throw.
- Consent checks live in the WRITE paths (transcript upload) AND the READ
  paths (getVoiceSource) — keep both; one is a UI, the other is the law.
- No raw hex in components; no color that isn't a token.
- No vendor API call in any request path — jobs fetch, tenants read our rows (D10).
- Every integration: `types/live/demo/index` under `src/lib/adapters/<name>/`.
- Demo and real rows never mix in one view (D5); demo gets one quiet label.
- Server Actions for forms, not API routes; Zod on both sides; honeypot + rate limit.
- Dates in frontmatter are `YYYY-MM-DD` strings; format via `formatPostDate` only.
- `withTenant` for all tenant data; `platformQuery` sees only tenants/domains.
- Secrets: names in the DB, values in the provider. Nothing returns a value.

## Gotchas (the silent hour-wasters)

- **`SET LOCAL` vs `SET` under pooling:** session-level `SET` leaks the
  previous request's tenant onto the next request sharing the connection —
  no error, wrong tenant's data. `withTenant` uses `set_config(..., true)`
  inside a transaction; never "simplify" it to `SET`.
  `tests/rls-isolation.test.ts` has a regression test for exactly this.
- **`next/font` is build-time** and only legal in the page/layout module
  graph. That's why `fonts.ts` (loaders, imported by the root layout ONLY)
  and `font-pairings.ts` (pure data, importable anywhere) are separate files.
  Import fonts.ts from a route handler and the build fails cryptically.
  Also: loader args must be inline literals — no shared `subsets` variable.
- **`new Date("2026-07-04")` renders July 3rd** in every western timezone
  (parsed as UTC midnight). Frontmatter dates stay strings; `formatPostDate`
  pins to local noon. RSS pubDates do the same.
- **Cache-tag scoping:** everything cached for a tenant carries
  `tenant:<slug>` and nothing else's. One shop's edit must never invalidate
  199 others (Part 4). If you add an `unstable_cache`, tag it.
- **The tenant row rides outside the bundle cache** (see tenancy section).
  Status gates break subtly if you "clean up" the fresh-merge in
  `getTenantBundle`.
- **pg returns `timestamptz` as Date objects, `numeric` as strings**
  (rating is type-parsed to float in db.ts). The sitemap once 500'd on
  `updated_at.slice` — coerce before formatting.
- **One transaction = one client = sequential queries.** `Promise.all` over
  the same `db` handle triggers pg's deprecated query-queuing. Parallelize
  across `withTenant` calls, not within one.
- **Windows orphan processes:** stopping the npm wrapper can leave the node
  child serving a **stale build** on :3000 and your next verification pass
  lies to you. Before re-verifying: `Get-NetTCPConnection -LocalPort 3000`
  and kill the owning PID.
- **Windows native binaries don't auto-install** (npm optional-deps bug):
  lightningcss, Tailwind oxide, rolldown, and **sharp** (`@img/sharp-win32-x64`,
  needed by the image optimizer — without it every `/_next/image` request
  500s) are pinned as devDependencies. The `@img` binary version must match
  the `sharp` JS version node_modules resolves, or sharp throws
  `Cannot read properties of undefined (reading 'output')` at require time.
- **The image optimizer's internal fetch carries no Host header** (Next 16
  `fetchInternalImage` mocks the request), so it can't resolve a tenant.
  proxy.ts special-cases `/uploads/<slug>/…` and routes it by the slug in
  the path. If local images ever 400 with "isn't a valid image", suspect
  this path first. Moot in production once uploads live on Azure Blob
  (remotePatterns, Session 4).
- **Blob CORS:** `next/image` fetches blob URLs server-side (no CORS), but
  any client-side fetch of blob assets needs the storage account's CORS
  rules; RUNBOOK.md Phase 4.2 sets them.
- **`TRUST_PROXY_HOST=1` means "believe X-Forwarded-Host".** In production
  the edge Worker overwrites that header on every request, so it's safe —
  and REQUIRED, because ACA ingress only routes its own FQDN, so the real
  hostname can't arrive as `Host`. Never set the flag on a server clients
  can reach without such a proxy: it would let anyone impersonate any
  tenant's hostname with one curl header.
- **ISR windows:** pages are dynamic per request, but the data bundle is
  600s-cached — a direct SQL write "not showing up" is almost always just
  the window. Portal writes bypass it via `updateTag`.
- **New DB roles see "relation does not exist", not "permission denied":**
  Session 1 revoked the public schema's default USAGE, so table GRANTs alone
  aren't enough — a new role needs `GRANT USAGE ON SCHEMA public` first
  (migration 003 learned this the hard way). The error genuinely looks like
  a missing table.
- **Server-action `redirect()` renders the target without the browser's Host
  header** — on this host-routed app that streams the WRONG surface (platform
  home instead of the admin). Auth flows return `{step:"done"}` and
  `window.location.assign()` instead. Same family: after a plain form action,
  a dynamic admin page keeps its stale RSC payload — hence `refreshAdmin()`
  (`revalidatePath("/admin", "layout")`) at the end of every staff mutation.
- **In-memory rate limiters outlive test runs:** the server process keeps its
  windows across repeated verify loops. Staff login therefore counts only
  FAILED attempts, and the intake limit is deliberately generous (honeypot +
  Zod are the real gate). If a login mysteriously blocks during local
  testing, you found this paragraph.
- **The demo Cloudflare provider verifies on the first jobs run.** It has a
  ~90s in-memory soak, but Next bundles the module separately per route, so
  the jobs route sees a fresh (empty) map and treats the id as
  already-active. Harmless for the local demo (verification just isn't
  delayed); worth knowing before trusting module-level state to be shared
  across routes anywhere else.

## Tests

```
npm run test:rls    # D4 isolation gate — vitest, real DB, app role, both attack paths
npm run test:growth # scheduler stagger/quota/backoff math, LA month boundaries,
                    # report honesty rules, the NAP/DNI invariant (Inv. 6), and a
                    # real-DB quota-failure-mid-batch degradation test (Part 10.4)
npm run test:e2e    # Playwright vs production server: smoke (18), lifecycle (4),
                    # axe (23 — includes the report artifact), control-plane (4)
npm run verify      # build + all three suites
```

CI (`.github/workflows/ci.yml`) refuses to pass without
`tests/rls-isolation.test.ts` present (Invariant 2) and fails on any axe
violation (Invariant 8/D12 — run per tenant against real tokens, which is how
an off-palette stat number got caught during this build).
