# ASSUMPTIONS.md — Session 1 (tenant app)

Every decision made without asking, per the build prompt. Where D3 said
"pick one," the pick and the why are here.

## Service picks (D3 "pick one")

1. **Email: Resend** (not Azure Communication Services Email). Cleaner REST
   API for plain-fetch (no SDK), Audiences gives newsletter sync for free,
   and per-domain DKIM setup is simpler to script in Session 4. Swap point if
   this is wrong: `src/lib/adapters/email/live.ts` + `newsletter/live.ts`.
2. **Analytics: Plausible** (not PostHog). Cookieless — which is load-bearing
   for D13: with no non-essential cookies set, tenant sites don't need a
   consent banner, and a CMP retrofit is exactly the kind of thing that would
   touch 200 sites at once. Conversions write to our own `events` table
   regardless (D14); Plausible is supplementary traffic context.

## Stack and platform

3. **Next.js 16.2 (App Router, Turbopack) + Tailwind v4 + node-postgres.**
   "Latest stable" at build time. No ORM: raw SQL through one data-access
   module keeps the RLS transaction discipline visible and greppable.
4. **`proxy.ts`, not `middleware.ts`** — Next 16 renamed the convention.
5. **Local dev DB is the `curbside-postgres` Docker container**
   (postgres:16-alpine, db `curbside`, owner role `curbside_owner`,
   app role `curbside_app` with NOBYPASSRLS). `docker-compose.yml` matches.
6. **MDX bodies render as CommonMark+GFM via react-markdown in v1.** D18 says
   "MDX body"; nothing in the seeded content uses JSX. The seam to add real
   MDX component support is one function: `src/components/markdown.tsx`.
   Chose this because react-markdown is safe-by-default (no raw HTML) — that
   matters once clients edit content in the portal.

## Tenancy and rendering

7. **Platform subdomains are always `noindex`** (robots meta + robots.txt
   Disallow), even for live tenants — they're the sales/preview surface, and
   indexing them would create duplicate content against the client's real
   domain. The custom domain is the only indexable copy.
8. **Draft gating uses a preview-token cookie** (`?preview=<token>` handshake
   in proxy.ts, token on the tenants row). "Visible to staff" (Part 2)
   resolves to the same mechanism until staff auth exists (Session 2): staff
   share the preview link. Logged as a control-plane follow-up.
9. **Tenant bundle is cached 600s, tagged `tenant:<slug>`; the tenant row
   itself (status, preview token, features) is re-read every request.**
   Status flips (suspend/offboard) take effect on the next request without
   waiting for a cache window; content/config changes go instant only through
   the portal's `updateTag` path, otherwise within 10 minutes. The control
   plane (Session 2) must call `revalidateTag(tenantTag(slug), "max")` after
   any direct DB write.
10. **Custom domains for local verification use `.test` hostnames**
    (`ironridgeoffroad.test`) exercised via Host headers — browsers can't
    resolve them without hosts-file edits, `*.localhost` covers browser
    testing. Real custom domains arrive with Cloudflare in Session 4.

## Auth

11. **Portal magic-link emails print to the server console while the email
    integration is in demo mode.** The flow is fully functional end to end;
    only delivery is local. E2E tests mint sessions through the real
    `portal_sessions` table rather than scraping console output.
12. **`/api/status` is guarded by a static bearer token** (`STAFF_STATUS_TOKEN`)
    until the control plane ships real staff auth with MFA (D16, Session 2).

## Features

13. **Change-request demo parser handles hours and tagline changes
    deterministically; everything else escalates.** The live Anthropic parser
    (claude-sonnet-5, forced tool use, Zod-validated output) is implemented
    and activates with a key + `mode='live'` — zero code changes. Even live,
    unparseable requests escalate rather than guess (D9).
14. **Booking stub routes slot picks into the quote form** and records
    `booking_started`. Real inventory/confirmation is `// TODO: LIVE` in
    `src/lib/adapters/booking/live.ts` (which throws if flagged live —
    half-configured must be loud, D11).
15. **Payments live mode throws by design** (D7 defers processing). The demo
    callout is the only v1 behavior; `payments` feature flag controls whether
    the callout section renders at all.
16. **Call tracking live mode expects `dni_display`/`dni_tel` in row config**
    (provider provisioning is a Session 3+ concern). The NAP invariant is
    enforced structurally: JSON-LD and llms.txt read `business_profile.nap`
    directly and never see the adapter.
17. **Rate limiting is in-memory per instance.** Honest limitation: at >1
    Container Apps replica each replica has its own window. The honeypot and
    Zod validation are the real gate; revisit with a shared store only if
    abuse appears.
18. **Lead photo uploads go to local disk (`.data/uploads`) behind a
    provider seam** (`src/lib/blob.ts`); Azure Blob lands in Session 4.

## Data and content

19. **Demo tenants:** Iron Ridge Offroad (Victorville — Johnson Valley / El
    Mirage / KOH flavor, dark industrial brand, Bebas/Inter) and Delta Marine
    Service (Discovery Bay — California Delta flavor, light nautical brand,
    League Spartan/Libre Franklin). Deliberately opposite palettes to prove
    per-tenant brand range and per-tenant contrast checking.
20. **schema.org subtype for the marine tenant is generic `LocalBusiness`** —
    schema.org has no boat-repair subtype. The off-road tenant uses
    `AutoRepair` (most-specific rule, Part 9).
21. **Demo review dates/localization are fictional but plausible**; all demo
    rows carry `is_demo=true` and the on-page "sample reviews" label (D5).
    `aggregateRating` never emits from them (Invariant 7, tested).
22. **`billing` table deferred to Session 2** — it's in ARCHITECTURE §4 but
    has no consumer in the tenant app; `tenants.plan_tier` + `features`
    cover rendering. Creating it now would be dead schema for Session 2 to
    reshape.
23. **Blog tag filtering is a `?tag=` query param** (renders dynamically),
    not static per-tag routes — fewer routes, and tag pages aren't an SEO
    surface worth pre-rendering at this scale.

## Scope cuts (from the stubbed list, per Part 13)

24. **Customer portal shell ("your lift kit is in progress") not built.**
    Cut to protect quality of the client portal + change-request chat, which
    share its surface. The seam is clear: a `jobs` table + a
    customer-scoped magic-link view; nothing in core blocks it.
25. **Live quote-assistant (Anthropic) implemented as a throwing stub** —
    demo responses only in v1 (the sellable demo exists; the price book
    grounding it needs doesn't yet).
26. **Design-as-config theme editor**: not v1 (Part 14 says so), but the
    primitives it needs all exist — tokens/pairing key/sections are DB rows,
    and `contrastReport()` in `src/lib/brand.ts` is the write-time validator
    it must call.

## Image sourcing workflow (Part 10)

28. **Stock providers: Pexels preferred, Openverse keyless fallback.**
    Pexels (one free key, commercial license, no attribution required) when
    `PEXELS_API_KEY` is set; otherwise Openverse anonymously (20 req/min,
    200/day) filtered to commercial CC licenses. CC BY/BY-SA require
    attribution, so the gallery section renders a "Photo credits" block from
    `images.credit`. Unsplash rejected — production access needs app review.
    Swap point: `scripts/lib/image-sourcing.ts → searchPexels/searchOpenverse`.
29. **The AI step generates search queries, not image picks.** `--ai` has
    Claude (claude-opus-4-8) rewrite each slot's query to fit the tenant's
    narrative (region, trade, customers' vehicles); the provider finds
    candidates; **a human approves every image** via the generated contact
    sheet before a site ships.
30. **Ops scripts read `PEXELS_API_KEY` / `ANTHROPIC_API_KEY` from the
    operator's environment**, not from integrations rows — they run on a
    laptop/CI, not in the app, and the keys are Curbside-owned platform keys.
31. **`--auto` mode + seed bootstrap (user-requested):** demo tenants must
    never show bare placeholders, so `db:seed` auto-sources and applies the
    top candidate per slot (skipped in CI/offline — placeholders still look
    finished, D11). This is a demo-only convenience, not a bypass of the
    Part 10 human gate: the contact sheet is always written with applied
    picks marked, `--auto` prints a review warning, and the go-live runbook
    requires the review pass. Reviewed picks persist in each slot's
    `meta.json` (`applied`), so re-seeding reproduces the curated demo
    instead of reverting to candidate #1. Openverse pick quality is rough —
    expect to swap several via `--apply` (that's the reviewed workflow, and
    exactly what happened for both seed demos).
32. **Openverse search quirks handled in code:** its AND-ish matching starves
    5-6 word queries (progressive relaxation drops trailing words until ≥3
    results); 1-2 hit result sets are usually text-match noise; PNG/SVG
    results are usually diagrams or logos (JPEGs sort first, SVG skipped);
    Wikimedia 429s UA-less downloads (a User-Agent is always sent).

## Verification environment

27. **`ALLOW_ENV_SECRETS=1` is set in `.env.local`** so local `next start`
    (NODE_ENV=production) can use the env secret provider without warning
    spam. Real infrastructure must set `SECRET_PROVIDER=keyvault`, and the
    keyvault provider throws until Session 4 wires it — nothing can silently
    ship env-file secrets to production.
