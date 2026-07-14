# Curbside Sites — Tenant App

One Next.js application that renders **any** Curbside Sites client from a
database record. One codebase, N tenants, zero per-client code in core —
that rule (D1) governs everything; the full decision record lives in
`../ARCHITECTURE.md` (D1–D20 + invariants), and this app is Session 1 of the
build plan in `../00-BUILD-PROMPT.md`.

This README is the handoff document: you should be able to continue from
this file alone.

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

# 5. Run it
npm run dev        # or: npm run build && npm start
```

Then browse — both of these are the same running server:

- http://iron-ridge-offroad.localhost:3000 — off-road shop, dark industrial brand
- http://delta-marine-service.localhost:3000 — boat service, light nautical brand

Custom-domain routing is testable without DNS: `curl -H "Host: ironridgeoffroad.test" http://127.0.0.1:3000/`.

Full verification (build + RLS gate + smoke + axe): `npm run verify`.

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

## Directory map (★ = the files you'll edit most)

```
migrations/            forward-only SQL; 001 has every table + RLS policy
scripts/               migrate, seed, export-static (D6), fetch-reviews, fetch-instagram
src/
  proxy.ts             Host → /s/<host>/ rewrite + ?preview= cookie handshake
  lib/
    db.ts              withTenant / platformQuery — THE ONLY pool access
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
    api/status/        staff go-live checklist (not host-scoped)
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
- **Customer portal shell** (cut this session, see ASSUMPTIONS #24).
- **Static failover upload + Cloudflare health check** → `scripts/export-static.ts`
  produces verified snapshots in `.data/failover-snapshots/`; Session 4 wires
  Blob upload + serving, Session 2 wires the alerting.

## Conventions to preserve

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
- **Blob CORS (Session 4):** `next/image` fetches blob URLs server-side (no
  CORS), but any client-side fetch of blob assets needs the storage
  account's CORS rules; the runbook covers it.
- **ISR windows:** pages are dynamic per request, but the data bundle is
  600s-cached — a direct SQL write "not showing up" is almost always just
  the window. Portal writes bypass it via `updateTag`.

## Tests

```
npm run test:rls   # D4 isolation gate — vitest, real DB, app role, both attack paths
npm run test:e2e   # Playwright vs production server: smoke (18), lifecycle (4), axe (22)
npm run verify     # build + both suites
```

CI (`.github/workflows/ci.yml`) refuses to pass without
`tests/rls-isolation.test.ts` present (Invariant 2) and fails on any axe
violation (Invariant 8/D12 — run per tenant against real tokens, which is how
an off-palette stat number got caught during this build).
