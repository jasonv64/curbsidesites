# ASSUMPTIONS.md — Sessions 1, 2, 3 & 4

Session 1 (tenant app) is #1–32; Session 2 (control plane) is #33–52;
Session 3 (growth plane) is #53–70; Session 4 (the runbook + production
seams) starts at #71.

# Session 1 (tenant app)

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

---

# Session 2 (control plane)

## Architecture

33. **A second NOBYPASSRLS database role, `curbside_control`,** carries the
    control plane (staff surface, intake pipeline, jobs, webhooks). Its
    cross-tenant reach comes from explicit permissive RLS policies (002), not
    from bypassing RLS. The tenant app's `curbside_app` role gained NOTHING:
    still read-only on tenants/domains, still blind to staff, billing,
    consent, and alarm tables — D16's "never conflated" enforced by Postgres,
    not convention. Gotcha discovered en route: Session 1 revoked the public
    schema's default USAGE, so a new role sees "relation does not exist"
    (not "permission denied") until granted schema USAGE — migration 003.
34. **Control-plane hosts are reserved, not tenants:** `admin.<apex>` →
    `/admin` (staff), bare apex / `www.` → `/platform` (public intake; grows
    into curbsidesites.com in Session 5, noindex until then). A CHECK
    constraint on `tenants.slug` makes collisions impossible, not unlikely.
35. **Staff auth (D16) is passwords (scrypt) + TOTP (RFC 6238), no vendor.**
    TOTP implemented on node:crypto (~60 lines, interop-tested against an
    independent implementation in the e2e suite); secrets AES-256-GCM
    encrypted at rest with `STAFF_TOTP_ENC_KEY`. Enrollment is FORCED at
    first login — there is no password-only state that can reach the fleet.
    Sessions: 12h, sha256-hashed tokens, `mfa_ok` gate. Login rate limit
    counts only FAILED attempts.

## Onboarding pipeline

36. **Intake defaults:** new tenants land as `plan_tier='curb'` (the
    mandatory base plan; upgrades come from billing sync), features straight
    from the add-on checkboxes (D19), slug deduped inside the transaction.
    The 30-minute call auto-books for the next business day 10:00 local —
    a real scheduler (Cal.com etc.) is a later swap; the seam is the
    `onboarding_calls` row.
37. **Brand proposals are generated, the gate is human (2.3):** industry
    preset (palette + font pairing + texture notes + do-not-do list) tinted
    by dominant colors sharp extracts from the uploaded mark, then
    auto-adjusted until the same WCAG math CI runs passes. Staff approve or
    reject as-is in v1 (token editing happens via a re-upload or SQL until
    the Part-14 theme editor exists). The DRAFT renders with proposed tokens
    immediately — the gate blocks go-live, not browsability.
38. **"Immediately browsable" (2.5) = the Session-1 preview-token link** on
    the platform subdomain; the intake success page and the receipt email
    both carry it. Drafts stay invisible without the token (ASSUMPTIONS #8).
39. **Go-live rule:** `draft → live` requires the latest brand proposal
    approved AND a verified domain — or a staff "force" for
    platform-subdomain-only tenants. Domain verification triggers the flip
    automatically once the gate has passed (2.5), from the polling job.

## Domains

40. **Registrar instructions are DNS records (CNAME + ownership TXT), not
    nameserver transfers** — that's how Cloudflare for SaaS custom hostnames
    actually work; the client keeps their DNS. Instructions are
    registrar-specific click-paths (GoDaddy/Namecheap/Squarespace/Cloudflare/
    IONOS/NetSol + a generic fallback). Chase cadence: every 3 days,
    automatic, with a staff alert (2.5: "clients are slow at this").
41. **The demo hostname provider simulates verification.** Designed as a
    ~90s in-memory soak, but Next instantiates the module per route bundle,
    so in practice demo domains verify on the FIRST jobs run (unknown id →
    optimistic active). Kept as-is: the local flow still exercises
    provision → poll → verified → notify → go-live, just without the delay.
    Live mode = `CLOUDFLARE_ZONE_ID` + the token secret; zone-without-token
    throws (D11 half-configured rule applied to platform adapters).

## Billing

42. **v1 Stripe scope is webhook ingest + sync.** Subscriptions get created
    in the Stripe dashboard (Session 4 runbook); metadata.tenant_slug links
    the customer on first event. Price ids map to plan tiers and feature
    flags via `STRIPE_PRICE_MAP` (demo ids default). Sync only touches flags
    the map knows — intake checkboxes and custom flags survive.
43. **The demo Stripe provider is only selectable when the webhook secret is
    absent** and only accepts `stripe-signature: demo` — a deployment with
    the real secret can never fall back to accepting unsigned events.
    `npm run stripe:simulate` drives it; `--days-ago` backdates
    `event.created` so the dunning ladder is testable without waiting 14 days.
44. **Nothing automated ever suspends:** dunning (day 3/7/14 warnings from
    `first_failed_at`) ends by CREATING a `pending_actions` row; only
    `approveSuspension` (a staff click in the queue) or a manual staff
    action writes `status='suspended'`. `invoice.paid` auto-dismisses a
    pending suspension — recovered clients never meet the gate.

## Watching / jobs

45. **The suspended-tenant gate is layout-level (Session 1 design):** the
    visible page is the under-construction screen and nothing else, but the
    HTML's RSC flight payload still serializes the (public, marketing-only)
    child page. Accepted for v1 since nothing non-public renders through
    that path; revisit if that ever changes. The e2e asserts on the
    rendered DOM.
46. **Two Next-16 gotchas cost real time and are now conventions:**
    (a) server-action `redirect()` streams the target rendered WITHOUT the
    browser's Host header — on a host-routed app that is the WRONG surface;
    auth flows therefore return a `done` state and hard-navigate
    client-side. (b) Dynamic admin pages keep a stale RSC payload after a
    plain form action; every staff mutation calls
    `revalidatePath("/admin", "layout")` (`refreshAdmin()`).
47. **Jobs run in-process** (`POST /api/jobs/run`, CRON_TOKEN or staff
    session; `npm run jobs` is an HTTP trigger) because they use the app's
    adapters and cache. Deliverability checks skip `.test`/`.localhost`
    domains (ok=NULL, "skipped" recorded) rather than fake a result. The
    synthetic form check exercises the tenant-scoped DB write path + the
    real email adapter and cross-checks the row landed in the right tenant;
    the HTTP form layer is covered by the Playwright suite instead.
48. **Zero-submission alarm semantics:** baseline = any non-demo,
    non-synthetic lead ever; fires at 14 quiet days; deduped against the
    open alert so it fires once per incident, not once per jobs run.
49. **Fleet dashboard honesty:** CWV column reads "n/a (S4)" until real-user
    monitoring exists; uptime/failover joins when Session 4's health checks
    write `failover` alerts. The fire-score sort is a first guess, per
    Part 0 — expected to be rewritten after four real clients.

## Content & offboarding

50. **Content seeding voice/consent order:** consented transcript →
    intake voice field; an UNCONSENTED transcript is a hard refusal
    (ConsentError), surfaced in the admin UI, proven by e2e against a
    seeded bad-data tenant. Generator: claude-opus-4-8 via raw fetch when
    `curbside-anthropic-api-key` resolves, else deterministic templates
    (the pipeline must work offline). Posts land UNPUBLISHED always;
    tagline/about apply directly only while the tenant is still draft
    (the go-live review covers them) — live tenants' site copy belongs to
    Session 3's pipeline.
51. **Offboarding writes the exit DATA now, the exit REPORT in Session 3:**
    JSON + leads CSV under `.data/exports/<slug>/`, shaped so the
    monthly-report renderer (GROWTH Part 5) can produce the formatted exit
    report from the same file (D20: build it once). Secret purge = the
    manifest of vault names + integrations flipped to demo; actual vault
    deletion automates in Session 4 when a vault exists. Transcripts and
    recording pointers are hard-deleted, not archived.
52. **Staff-decision FKs are ON DELETE SET NULL** (migration 004): removing
    a staff account never blocks on, or cascades into, decision history —
    the durable "who" is the email in audit_log.

---

# Session 3 (growth plane)

## The monthly report (Part 5)

53. **Report months are America/Los_Angeles calendar months.** All clients are
    California businesses (D12 rationale); a UTC boundary would file every
    evening conversion from the 31st under the wrong month. The math lives in
    `src/lib/growth/period.ts` and is unit-tested against the DST switch and
    the UTC/LA disagreement window.
54. **Report data is FROZEN at generation and a SENT report is immutable.**
    `reports.data` holds the assembled numbers; portal/PDF/email all render
    from it, never re-query. Regenerating an unsent report replaces it;
    regenerating a sent one is refused (a client must never re-open a report
    and find different numbers). Corrections go in next month's notes.
55. **Monthly reports auto-send.** The scheduler generates + emails on/after
    the 2nd (staggered across 4 days). Staff shape the narrative via
    `report_notes` (why/next) any time during the month; there is no hold
    queue in v1 — at 200 tenants a manual send gate is a monthly chore that
    would quietly stop happening. The admin Generate button exists for
    previews (read before it sends), samples, and catch-ups.
56. **The report's lead number counts leads-table rows for form submissions
    (server truth — beacons get ad-blocked) plus call_tap/map_tap events.**
    Demo rows feed ONLY kind='sample' reports, which carry a "demonstration
    data" band and are never emailed (D5 + Invariant 12).
57. **"Previous month exists" = tenant existed OR data exists in that window.**
    Found by reading the seeded sample as the shop owner (Part 10.2): the
    first cut gated the trend line on tenants.created_at alone and told a
    tenant with three months of history it was their first month.
58. **PDF renders via Playwright's bundled Chromium** (already a devDependency
    for e2e). When it's absent (a lean production container), generation and
    email still run and pdf_path stays NULL — logged, never faked. Session 4
    decides the production PDF story (chromium in the jobs image, or a
    render service).
59. **The exit report (D20) generates at offboarding** into
    `.data/exports/<slug>/` as HTML alongside the raw JSON export — same
    assembler, same renderer, kind='exit', period = full engagement. Its
    failure never blocks the export (the frozen data suffices to regenerate).

## Scheduler (Parts 2, 9.3)

60. **Staggering is a deterministic hash of tenant+job over epoch-anchored
    windows** — same slot every cycle, no drift when a run lands late, no
    thundering herd on a fresh fleet (first runs land in each tenant's future
    slot, verified: 30 schedule rows created, 0 due on the first tick).
    Reviews: 14-day window. Ranks/NAP: weekly. Solicitation: daily.
    Content/report: month-anchored (1st/2nd) spread over 4 days.
61. **Vendor quotas are platform-level UTC day-budgets** (`vendor_quotas`),
    conservative by default (yelp 250/day vs the 300 free tier), overridable
    via `QUOTA_<VENDOR>_PER_DAY`. A spent budget DEFERS the job 6h — no
    error, no backoff, no last_error_at, other tenants untouched (proven in
    tests/growth-quota.test.ts against the real DB).
62. **Real failures back off exponentially per tenant+job** (30min · 2^n,
    cap 24h) and stamp last_error_at on the integration row; the read path
    serves cached rows throughout (D11). Operator errors (consent refusals,
    half-configured LIVE integrations) alert immediately; transient failures
    alert on the third consecutive miss.

## Instrumentation

63. **`events.is_demo` added (migration 005).** Real beacons/actions always
    write false; seed data writes true; the portal tiles and every report
    select real-else-demo, never both (D5).
64. **Rank tracking (Part 8): no SERP vendor is named in D3, so none was
    picked.** The integration row + schema + report section exist; live mode
    THROWS naming this decision and `src/lib/growth/rank-tracking.ts` as the
    seam (D11 half-configured rule). Demo snapshots are deterministic per
    term+week and feed sample reports only. Terms cap at 20 per tenant —
    enforced in code, seeded as service × city + service + "near me".
65. **GBP adapter (Part 7) is read-only v1** (NAP + categories via the
    Business Information API; config.location_id + an OAuth bearer secret,
    manager access per D8). Demo mode reports "couldn't look" (nap_checks
    ok=NULL) — a drift monitor that fakes a pass is worse than none. OAuth
    refresh-token plumbing is a Session 4 runbook item.
66. **NAP drift v1 surfaces:** our own JSON-LD and llms.txt (run through the
    REAL builders against DB truth — also re-proving Invariant 6 weekly) plus
    GBP when live. Yelp/directories join when their adapters gain read scopes.
67. **Review solicitation is email-only** (SMS is A2P-blocked, ARCHITECTURE
    §6), fires 3 days after a lead is marked WON, only for leads with an
    email, once per lead ever (lead_id UNIQUE), Curb+ and up (D19). The ask
    email includes direct Google/Yelp write-a-review links only when we
    actually hold the place/business id — never guessed URLs.
68. **Content calendar (Part 6): curb 0 / curb+ 2 / curb_pro 4 posts a month**
    (+`features.extra_posts` for the à-la-carte add-on). Drafts land
    UNPUBLISHED with a `review_content` queue item; the existing per-post
    publish flow is the human gate. Internal links to a service section and
    /contact are POST-PROCESSED in (`ensureInternalLinks`) when the generator
    forgot them — the step everyone skips is code, not discipline. Voice
    resolution reuses Session 2's consent-gated `getVoiceSource`; ConsentError
    surfaces as a critical alert, never a workaround.
69. **The June 2026 iron-ridge "monthly" (real data, 0 contacts) was generated
    and console-sent during verification** and left in place deliberately —
    it is an honest artifact of a tenant with no real traffic and proves the
    thin-month degradation (Part 10.8) end to end.
70. **e2e intake assertion updated 11 → 13 integration rows** (gbp +
    rank_tracking added to the onboarding pipeline; migration 005 backfills
    existing tenants).

---

# Session 4 (the runbook + production seams)

Session 4's deliverables are `RUNBOOK.md`, `COSTS.md`, and `CALENDAR.md`.
It also wired the code seams earlier sessions explicitly deferred to it
(Key Vault provider, Azure Blob uploads, failover upload/serving, the
Docker image) — a runbook step that says "now paste 60 lines of TypeScript"
is not an executable instruction set.

## Topology decisions

71. **Region: `westus3`.** Closest modern region (availability zones,
    current SKUs) to Southern California clients; `westus` is older and
    capacity-constrained, `westus2` is farther for no saving. DB and
    Container Apps co-located there per D15 — a tenant render is several
    sequential queries and pays inter-region latency per query.
72. **Database network model v1: public access + firewall** (operator IP +
    the allow-azure-services rule), TLS required, NOBYPASSRLS roles with
    strong passwords. VNet integration is deliberately deferred to the
    Burstable→General-Purpose move (~50 tenants, COSTS.md) — a solo
    operator gets a debuggable database now; the upgrade path is written
    down where the money is.
73. **The edge is one Cloudflare Worker on route `*/*`** (repo:
    `infra/cloudflare/`). Verified against Cloudflare's docs: a `*/*` route
    on the SaaS zone catches custom-hostname (client-domain) traffic too,
    so one Worker fronts the entire fleet. It re-addresses requests to the
    ACA FQDN carrying the visitor host in `X-Forwarded-Host`
    (`TRUST_PROXY_HOST=1` makes proxy.ts trust it — never set that flag
    without a proxy that overwrites the header), which means **ACA never
    needs per-tenant custom-domain bindings** and the fallback origin stays
    originless (`AAAA 100::`), exactly the documented Workers-as-origin
    pattern. Rejected: Cloudflare Load Balancer + an nginx snapshot
    container (two more paid/managed pieces to do the same two jobs).
74. **Static failover serving (D6) is the same Worker:** origin
    unreachable/5xx on GET → serve `failover/<hostname>/<page>.html` from
    Blob and email staff via Resend directly from the edge (deduped 15 min
    per host, `caches.default`). Failover responses carry
    `X-Curbside-Failover: 1` and the exporter refuses to re-snapshot them
    (no snapshot-of-a-snapshot). Honest limit: same-region Blob — this
    covers app/DB/deploy failures, not a full regional outage.
75. **Blob containers `tenant-images` and `failover` are public-read.**
    Everything in them is public by nature (site imagery, snapshot copies
    of public pages); lead-photo uploads are UUID-addressed. Revisit with
    SAS if clients ever upload anything sensitive.

## Code seams wired (and how)

76. **Key Vault provider** (`src/lib/secrets.ts`): @azure/keyvault-secrets +
    DefaultAzureCredential, lazy-imported so env mode never loads Azure
    SDKs; 5-min value cache (60s negative) — rotation lands within 5
    minutes, no deploy. 404 = unpopulated; other errors rethrow so live
    adapters demo-fallback and stamp `last_error_at` (D11).
77. **Sentry (D3) is NOT wired.** v1 alerting = the edge Worker's failover
    email + Azure Monitor metric alerts (RUNBOOK 11.3) + the in-app alarm
    dashboard. Logged as the honest gap; the D3 row stands as the intended
    vendor.
78. **The production image is one deliberately fat Dockerfile** (full
    node_modules, scripts/, tsx, and Playwright chromium). Resolves #58:
    report PDFs render in-process in production. Rejected `output:
    standalone` — the cron jobs need scripts/, and dynamic imports
    (playwright, @azure/*) defeat output tracing. Windows-vs-Linux native
    binaries: the four win32 pins moved devDependencies →
    **optionalDependencies** with their linux-x64 twins added, so `npm ci`
    works on both platforms (direct win32 devDeps hard-fail EBADPLATFORM on
    Linux).
79. **Scheduling is two ACA cron Jobs:** a 15-min tick (curl image POSTs
    `/api/jobs/run` at the ACA FQDN with CRON_TOKEN) and a nightly
    export+upload run of the app image (`EXPORT_DIRECT=1` — the exporter
    crawls `https://<hostname>` through the public edge, since ACA ingress
    won't route foreign Host headers). Export also runs post-deploy via
    `az containerapp job start` in the deploy ritual.
80. **`npm run staff:create`** (new) bootstraps the production staff user;
    `db:seed:fleet` is banned from production (it drags four fake tenants
    along). The two Session-1 demo tenants DO get seeded in production
    deliberately — they are the sales fleet (with `SKIP_IMAGE_SOURCING=1`;
    images move to Blob via RUNBOOK 10.3's upload-batch + URL rewrite
    rather than a new script).
81. **`/api/health`** (new, unauthenticated, returns only a boolean):
    DB-checked so ACA probes and edge failover react to a dead database,
    excluded from the host proxy so it answers on the bare FQDN.
82. **Runbook commands are PowerShell** — this project's operator is on
    Windows; a bash runbook would be translated live at the worst moment.
    Cost figures in COSTS.md are July-2026 list prices ±20%.
