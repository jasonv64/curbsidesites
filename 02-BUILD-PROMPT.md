# 02-BUILD-PROMPT.md — THE FORWARD PLAN

**Supersedes `00-BUILD-PROMPT.md` and `01-BUILD-PROMPT.md`** (2026-08-04; both
live in git history). Written after the architecture re-validation session:
an adversarial review of the decision record against the deployed system, with
every finding either fixed in the docs, recorded as a decision (D21–D28), or
queued below. The traceability table at the end maps every session and
requirement from the two old files to done / carried / cut — nothing was
dropped silently.

**How to run this.** Paste each session into a fresh build session with
`ARCHITECTURE.md` and `SPECS.md` attached (the four old spec files are now
those two). Run sessions **in order, as separate sessions** — except Session E,
which runs per-service on demand. Same standing rules as always: don't stop to
ask mid-build, make the call, log it in `ASSUMPTIONS.md` (#91 onward) —
**except** for anything on the stop-list (irreversible/destructive, production
data, security posture, spend, overturning a settled D-entry, credentials):
those stop and ask Jason. Run each session's verify checklist for real and
report honestly. **Do not describe a check you did not run.**

The invariants in `ARCHITECTURE.md` §7 hold in every session here. Nothing
below is permission to weaken tenant isolation, secret handling, the
accessibility gate, or NAP consistency. If an enhancement would touch core to
serve one tenant, it becomes a feature flag in core (D17), not an exception.
When reality contradicts a spec, amend the spec (each spec's Part 0) and leave
a one-line note.

---

## STATE OF THE WORLD (2026-08-04, verified — not aspirational)

**Built and proven:** Sessions 1–4 of the old plan. The tenant app, control
plane, and growth plane run in production on Azure Container Apps + Cloudflare
(`RUNBOOK.md` as-built table is the truth on deltas). RLS isolation passes
8/8 against a real DB. The first end-to-end go-live happened 2026-07-19:
www.dubdating.com, TLS and all — **and it is a test fixture, not a client
(D21)**. Failover snapshots are current. Stripe webhook ingest + dunning +
human-gated suspension exist.

**Not built, despite what the old prompts assumed:** the old Session 5.
Itemized: curbsidesites.com marketing site ✗ (a landing stub serves) ·
Checkout deposit collection ✗ · ACH-default signup ✗ · subscription creation
from the app ✗ · the live-reveal progress indicator ✗ · webhook sync ✓ ·
dunning ladder ✓. **The platform cannot bill a client today.** Old
`01-BUILD-PROMPT.md`'s "Sessions 1–5 are built, verified, and live"
precondition was false; this file's sequencing corrects for it.

**Known-red:** CI has failed on every run in repo history (the axe/lifecycle
e2e step) — D24 makes fixing it the first exit criterion. The origin honors
forged `X-Forwarded-Host` from anyone (D23). Four of five footer-credit
targets 404 (Invariant 11 status note). Open decisions needing Jason: D26
(pre-live data gate), D27 (Cloudflare managed robots vs llms.txt), D28
(single-operator continuity).

---

## SESSION 1 — HARDENING & THE TRUST BOUNDARY (was Session A, plus the 2026-08-04 review findings)

> A stabilization pass on a system that is already live. **Change no behavior
> except where a documented invariant is being violated** — every such case is
> named below, deliberately. If a change alters anything else a user sees,
> note it and defer it.
>
> **Read `ASSUMPTIONS.md` first — one file, sections #1–90, every entry
> dispositioned 2026-08-04.** The carried entries name their re-check
> triggers; several land in this session (#8/38, #12, #45, #77).
>
> **Exit criterion zero, before anything else (D24): one green CI run on
> `main`.** Name the failing e2e test from the run log (`gh run view
> --log-failed`), fix it, and then protect `main` (require `verify`) — the
> protection step is [YOU]. Until this passes, §7 #8's enforcement claim
> stays suspended and no other session runs.
>
> **The trust boundary (D23):** lock ACA ingress so only the edge Worker
> reaches the origin — shared-secret header set by the Worker and validated
> in `src/proxy.ts` before `X-Forwarded-Host` is trusted, or Cloudflare IP
> restrictions on ingress; pick one and record why. Acceptance is the exact
> attack that works today failing: `curl https://<ACA-FQDN>/ -H
> 'X-Forwarded-Host: iron-ridge-offroad.sites.curbsidesites.com'` returns
> 403, while the same page through Cloudflare returns 200.
>
> **Close the draft-tenant content disclosure.** An anonymous request to a
> `draft` tenant's platform subdomain returns the correct 404 *status* with
> ~21KB of that tenant's content still in the *body*: business name in
> `<title>`, phone, service names, and the owner's verbatim `voice` text from
> intake. `src/app/s/[host]/layout.tsx` calls `notFound()` correctly, but the
> layout's async gate and the page render concurrently — Next streams page
> HTML before the gate resolves, and the flushed markup stays in the
> response. Slugs are derived predictably from business names, so draft sites
> are enumerable by guessing. The spec (`src/lib/tenant.ts` header, and the
> layout's own docstring) says draft content is preview-cookie-only; it
> isn't. Move the gate ahead of any content rendering — the resolver already
> runs in `src/proxy.ts`, which is before render — rather than deepening the
> layout check. **This one does change what a user sees, deliberately:
> current behavior contradicts the documented invariant.** Regression test
> belongs with the tripwires.
> Reproduce (found while onboarding the `dub-dates` fixture, 2026-07-18):
> ```bash
> curl -s -o /dev/null -w '%{http_code}\n' https://<draft-slug>.sites.curbsidesites.com/   # 404
> curl -s https://<draft-slug>.sites.curbsidesites.com/ | grep -c '<title>'                # 1 — content leaked
> ```
>
> **Every new tenant must arrive with real photos — this is a D11 miss, not a
> polish item** (and ASSUMPTIONS #31 was refuted on it: the running dev DB has
> 0 of 10 image URLs on both flagship demo tenants). D11 requires a
> zero-config tenant to render "fully browsable, screenshot-ready." It
> doesn't: `createTenantFromIntake` inserts ~10 `images` rows with
> `search_query` set but `url` NULL, and sourcing is a separate manual CLI
> step (`npm run images:source <slug> -- --auto`) that nothing in the intake
> path calls. Confirmed on the `dub-dates` tenant created through the real
> form: 10 image rows, 0 with a URL, so the whole site rendered branded SVG
> placeholders. **The draft site is the sales artifact (SPECS.md §II 2.5)** —
> a prospect's first look at it is the demo, and placeholders undersell it
> exactly when it matters most. Wire sourcing into the intake pipeline so a
> tenant is never *created* without it, and make it write to blob storage
> rather than the local filesystem — the current `/uploads/<slug>/<file>`
> output only exists on the machine that ran the CLI, so a locally-sourced
> tenant still shows placeholders in production. Keep the existing non-fatal
> degrade (no network → placeholders keep serving), but surface it: a tenant
> whose images never sourced should raise a `pending_actions` item, not sit
> silently pretty-looking-in-dev and empty in prod. Preserve `images.credit`
> alongside `url` — Openverse results are CC BY / CC BY-SA and the credit is
> what satisfies the licence; a `url` written without a `credit` is a
> licensing bug.
>
> **Fix the two domain-instruction bugs found provisioning the dubdating.com
> fixture (2026-07-19), now settled as D22.** (a) `registrarInstructions`
> emits `CNAME <hostname> → sites-origin…` even when `<hostname>` is a zone
> **apex**, which is impossible (RFC 1034) on registrars without CNAME
> flattening — GoDaddy among them; the generator must branch on
> apex-vs-subdomain and, for an apex on a non-flattening registrar, instruct
> the `www` custom hostname plus a registrar apex-forward — **and the forward
> must land on HTTPS** (D22's invariant; today `http://dubdating.com` hops
> through cleartext). (b) Re-provisioning a domain after `releaseDomains`
> creates a fresh `domains` row with `registrar = NULL`, so the tailored
> registrar steps silently degrade to the generic "we have it as: unknown"
> fallback — carry the registrar (and any known intake context) forward, or
> look it up, when re-provisioning.
>
> **Fix the released-domain data + query bugs that broke the nightly export
> (found 2026-08, dub-dates).** Swapping a tenant's apex custom hostname for
> its `www` (via `releaseDomains` then `provisionDomain`) left **two
> `is_primary = true` rows** — the released apex and the new verified `www` —
> because `releaseDomains` marks a row `released` but never clears
> `is_primary`. Then `scripts/export-static.ts`'s `liveTenants` picks the
> primary hostname with `WHERE d.is_primary LIMIT 1` — no status filter, no
> ORDER BY — so it non-deterministically grabbed the **released apex**
> (`dubdating.com`), which now only GoDaddy-forwards with no cert and returns
> 403 on every page. The export correctly refused to promote the batch
> (Invariant 9), so failover snapshots silently went stale for a week with a
> green-looking system except the job status. Three fixes: (a)
> `releaseDomains` must set `is_primary = false` on release; (b)
> `liveTenants` must select the primary among **verified, non-released**
> domains and be deterministic (`WHERE is_primary AND verification_status =
> 'verified' ORDER BY verified_at DESC LIMIT 1`); (c) a **partial unique
> index** so a tenant can never hold two primary domains — the schema
> currently has no such constraint.
>
> **Fix the deliverability check's hostname (D22):** `src/lib/control/jobs.ts`
> looks up SPF/DKIM/DMARC at the site hostname (`www.<domain>`), where email
> authentication records never live — structurally guaranteed to false-alarm
> on every `www` custom hostname forever. Resolve at the registrable domain.
>
> **`noindex` the dub-dates fixture (D21)** — it is live and indexable with
> placeholder NAP in public structured data. Also resolve the Resend
> contradiction (`ONBOARDING.md` known gaps): DNS says a sending domain is
> configured; `/api/status` + `synthetic_checks` say what's real. Verify and
> update the doc.
>
> **Interim fix for the footer credits (Invariant 11 status note):** four of
> five variants point at marketing pages that don't exist yet. Until Session 2
> builds them, point every variant at a URL that returns 200 today, keep the
> anchor-text variety, and add the five-URLs-return-200 check as a test so the
> next dead target fails loudly instead of silently.
>
> **Also in this pass (from the old Session A, unchanged):** reconcile
> duplication across the three planes into shared modules (data-access,
> adapter selection, token/render path — one implementation each); tighten
> types, remove every `any`, make the Zod schemas the single source with no
> parallel hand-written types; consolidate migrations into a clean, ordered,
> replayable set — a fresh database from empty must reach the current schema
> with RLS intact; raise coverage on the things dangerous to break (the D4
> isolation test, the D11 zero-config acceptance test, the semantic health
> checks, the "aggregateRating only when live" gate, and — new — the
> "nothing automated ever suspends" rule from ASSUMPTIONS #44, promoted to a
> tested invariant on D7); fix every stale or aspirational README line
> against what the code actually does now.
>
> **[YOU] items batched for Jason, each already framed as a decision entry:**
> settle D26 (the pre-live data-quality gate's contents — then implement it
> in `maybeGoLive` this session), D27 (Cloudflare Managed robots.txt on or
> off — one dashboard toggle once decided, plus a test that served robots.txt
> equals the generated one), D28 (continuity: break-glass credentials, second
> alert recipient — then implement the code/infra parts), delete the stale
> world-readable `.curbside-env-01` copy sitting **inside the working tree**,
> and turn on branch protection after CI is green.
>
> **Acceptance:** CI green on `main`, protected; the forged-XFH curl returns
> 403 at the origin and 200 through the edge; an anonymous request to a draft
> tenant returns 404 with no tenant content anywhere in the body, and a
> preview-cookie request still renders in full; a tenant created through the
> intake form has a real, credited photo in every image slot with no manual
> step, in blob storage; no tenant can hold two primary domains (constraint,
> not convention) and the nightly export selects only verified, non-released
> primaries; the deliverability check reads the registrable domain; the
> fixture is noindexed; all five footer-credit URLs return 200, tested; a
> fresh clone plus a fresh database boots to two working demo tenants with
> zero manual steps; the full verify checklists from all three planes pass
> against a production server; `next build` is clean with no type escapes.
> Report what changed and what you deliberately left alone.

---

## SESSION 2 — CURBSIDE SELLS: THE MARKETING SITE + BILLING (was 00-BUILD-PROMPT Session 5)

> **This is the session that makes Curbside sellable.** It has two halves:
> the company's own marketing site, and the billing engine that lets us
> charge clients. When this session is done, we can sell a static site plus a
> care plan and get paid for it — which is the whole business at its floor.
> A platform you can't bill is a hobby, and that is the platform we have
> today.
>
> **What already exists (don't rebuild it):** Stripe webhook ingest
> (signature-verified, idempotent), subscription-state sync to `billing` /
> `tenants.plan_tier` / feature flags, the day-3/7/14 dunning ladder, and the
> human-gated suspension queue (ASSUMPTIONS #42–44). What's missing is the
> **front half**: products in Stripe, Checkout for the setup deposit, ACH
> default, subscription creation from the app, and the marketing surface.
>
> ### Half 1 — curbsidesites.com (the marketing site)
>
> A first-class site for Curbside Sites itself — brand, positioning, pricing
> narrative, how it works, a proof/demo path into real platform subdomains,
> and a clear CTA into onboarding (the control-plane intake already belongs
> here; this is the surrounding marketing surface and brand home).
>
> **Not another multi-tenant client.** Do not model Curbside as a `tenants`
> row unless you deliberately decide to and log it in `ASSUMPTIONS.md`.
> Prefer a dedicated marketing surface on curbsidesites.com that links into
> the platform, rather than bending D1 around ourselves.
>
> Building this makes the five footer-credit targets real (Invariant 11) —
> replace Session 1's interim targets with the real pages and keep the
> 200-check test.
>
> ### Half 2 — billing (D7)
>
> Build the client-billing front half. This is **billing clients**, not
> processing payments on client sites — Stripe **Connect** and client-side
> payments stay deferred (D7, Session E).
>
> - Stripe Billing on Curbside's own account. One Customer per tenant.
>   Subscriptions created from the app, not by hand in the dashboard.
> - **ACH default, card fallback**, ACH pre-selected at signup (D7).
> - **Automated dunning from day one** — the ladder exists; wire it to real
>   Stripe products and prove it against a real test-mode account, not just
>   `stripe:simulate`.
> - **One-time setup deposit collected via Checkout before a build begins.**
> - Webhooks sync subscription status → `billing` and `tenants.plan_tier`
>   (exists — verify against real test-mode events).
> - Every plan and add-on is a **feature flag on the tenant record** (D19).
>   Buying flips exactly one flag; no separate provisioning step.
> - The suspension path keeps its **human gate** (SPECS.md §II Part 4).
>   Never a webhook silently killing a live business's phone line over a $2
>   decline.
>
> ### The live reveal — the intake-to-demo moment
>
> This is the payoff of the entire demo-mode architecture, performed in front
> of the customer. When a visitor completes intake on curbsidesites.com **on
> their own**, they see a real-time progress indicator and are then handed a
> **live URL to their own demo site**, openable in a new tab, right then.
>
> - The progress indicator **tracks the real pipeline, not a fake timer.** It
>   advances on actual events: intake rows written → brand tokens derived
>   from their logo → images sourced (Session 1 wired this into intake) →
>   sections composed → platform subdomain serving. If the bar is theater and
>   the site 404s when it hits 100%, the best moment in the funnel becomes
>   the worst. Never fake it.
> - The URL is the **platform subdomain** (`<slug>.sites.curbsidesites.com`),
>   `draft` + `noindex`, which works the instant the tenant row exists
>   (SPECS.md §I Part 2). This is exactly why demo mode requires no API keys —
>   nothing in the reveal is waiting on integration config.
> - The revealed URL only appears **after the subdomain actually serves a
>   200**, verified, not assumed. Poll the real thing; reveal on success.
> - Failure is handled honestly: if the pipeline stalls, the visitor sees a
>   "we're finishing your preview, we'll email the link" path that captures
>   their email and hands off to the control-plane queue — never a spinner
>   that hangs forever.
> - This is a genuine tenant in `draft`, so everything downstream (brand
>   gate, the 30-min call, domain, go-live) picks up seamlessly from the
>   record the reveal just created. The reveal is the top of the onboarding
>   funnel, not a throwaway.
>
> ### Pricing on the page — only what's honestly sellable today
>
> - **Setup deposit + Curb ($199/mo care plan)** are fully real after this
>   session. Sell them.
> - **Curb+ and Curb Pro** contain services not yet live (SEO ops, call
>   tracking, etc.). Show them as "available on request" or hide them — never
>   list a feature on the pricing page that isn't live or honestly labeled.
>   Session F reconciles the full ladder once those services ship.
>
> ### On exit [YOU]: file the Twilio A2P brand + campaign registration
> (RUNBOOK Appendix B item #2) — its 10–15 business-day review is the longest
> fuse left and it needs this site to exist. This was the old plan's "week
> after Session 5" item and it has been waiting since.
>
> ### Acceptance
>
> Someone who has never heard of Curbside can land on curbsidesites.com,
> understand what we sell, complete intake, **watch a real progress
> indicator, open a live demo of their own site in a new tab**, pay the setup
> deposit, and be put on a recurring care-plan subscription — without a
> client domain or staff credentials. The progress indicator reflects real
> pipeline state and the URL only reveals after the subdomain serves a
> verified 200. A test subscription flips the right flag on the tenant
> record. No pricing-page line names a feature that isn't live. Footer-credit
> targets are real pages, tested.

---

## SESSION 3 — SCOPE & DESIGN CUTS (was Session B)

> **Decide what survives before building more.** The specs prioritize a small
> number of exceptionally well-executed pages; this pass makes that real by
> cutting, not adding. Do this before presets (Session 4) — presets are
> composed from the section registry, so shrink it to its best pieces first.
>
> **Deploy caution (D25):** there is no staging and no canary. The §5 interim
> rules apply with teeth here, because this session reshapes live tenants'
> pages: green CI before merge, `npm run verify` locally, and soak every cut
> on the two demo-fleet tenants before the fleet sees it.
>
> **Do:**
> - Audit every page, section, and component in the tenant app. For each:
>   keep, merge, or cut. A section that exists but never earns its place on a
>   real local-business site is weight — cut it. Fewer, better sections beat
>   a large menu of mediocre ones.
> - Collapse near-duplicate sections into one configurable section (D17 shape).
> - Prune the font-pairing set and the token palette to combinations that
>   actually look good and pass contrast per tenant (D12) — a curated 8, not
>   a ragged 15.
> - Remove dead code paths, unreachable props, and options no real client
>   would use.
>
> **The rule:** every cut is logged with a one-line reason, and every cut
> section is removed from the registry *and* from any tenant config that
> referenced it, with a sensible fallback so no live tenant breaks. Cutting a
> section must not 500 a page that used it.
>
> **Acceptance:** the section registry is smaller and every remaining section
> is one you'd put in front of a paying client; no tenant renders a broken or
> empty page as a result of a cut; the cut list is in `ASSUMPTIONS.md` with
> reasons.

---

## SESSION 4 — INDUSTRY PRESETS (was Session C)

> Turn the platform from "a website builder" into "the site *for your
> trade*." An industry preset is a named, sellable starting configuration —
> **not a new codebase.** It pre-fills the same tenant record the intake form
> writes: section selection and order, token palette, font pairing, demo copy
> and image slots, JSON-LD subtype, and the primary conversion action for
> that trade. One codebase (D1); a preset is data. If a preset ever needs
> something core lacks, that something becomes a registry section available
> to every preset (D17), never a fork.
>
> **The ICP note (D21):** the one go-live so far was a fixture outside the
> target market and does not widen §1's ICP. These presets aim at the stated
> market: trades, automotive, off-road, marine, home services.
>
> **Build the preset system, then author the first few presets.**
>
> **The system:**
> - A preset is a named record: `key`, display name, description, hero
>   imagery for the curbsidesites.com gallery, and the config bundle it
>   applies.
> - Applying a preset writes a normal `draft` tenant. Everything stays
>   editable afterward — a preset is a starting point, not a lock. The theme
>   editor (Session 5) can take it anywhere.
> - Presets compose with, not replace, the invariants: contrast still
>   validated per tenant (D12), NAP still single-homed (§7 #6), demo-vs-live
>   never mixed (§7 #5).
>
> **What makes each preset industry-specific is more than looks — it's the
> trust and discovery layer:**
> - **Correct JSON-LD subtype per trade** (`AutoRepair`, `TattooParlor`,
>   `GeneralContractor`, `ProfessionalService`, etc.) — this is where the SEO
>   actually lands, and it's the real moat over a pretty template.
> - **The right primary conversion action** — per-artist booking for a tattoo
>   shop, quote-with-photos for a contractor, before/after + seasonal CTA for
>   a solar cleaner, project case studies + credentials for a civil engineer
>   (not a "book now").
> - **The right section mix** — portfolio grid vs. service-area map vs.
>   project case studies — and trade-appropriate demo content that reads as a
>   real business in that industry (§7 #5's realism bar, applied per trade).
>
> **Author these first presets, each complete enough to demo live:**
> Tattoo shop · Mechanic / auto repair · Solar panel cleaning · Civil
> engineering · Contractor (with landscaping and home-builder as close
> variants).
>
> Name each one so it sells (the name shows in intake and on the gallery, and
> it's doing sales work — a shop owner should read it as "that's me," not as
> an internal codename). Give each real demo imagery per SPECS.md §I Part
> 10's sourcing-and-review discipline — no invented URLs, a human looks at
> every image, trade-correct or it's cut.
>
> **Intake integration:** the intake form asks "what's your business?" and
> uses the answer to *suggest* a preset — never lock it. An explicit "I want
> the ___ look" (from a visitor who saw it in the gallery) overrides the
> suggestion. Hybrids and unsure answers fall back to a sensible general
> preset. All paths just set a starting preset; nothing about this bypasses
> the brand gate or the editable record.
>
> **curbsidesites.com gallery:** a browsable wall of live industry demos,
> each a real platform-subdomain tenant a visitor can open and click through,
> each with a CTA that starts intake pre-seeded with that preset. This is the
> proof asset — the "imagine your shop, but already built" moment, multiplied
> across trades — and it feeds directly into the Session 2 live reveal.
>
> **Acceptance:** a visitor picks their trade (or a demo they liked), starts
> intake, and the live reveal (Session 2) hands them a demo already shaped
> for their industry — right sections, right schema subtype, right conversion
> action, trade-correct imagery. Adding a new industry later is authoring one
> preset record, zero core changes. Every preset passes the same per-tenant
> gates as any tenant.

---

## SESSION 5 — DESIGN-AS-CONFIG EDITOR (was Session D)

> Build the staff-gated theme editor described in SPECS.md §I Part 14. The
> primitives already exist — sections are config, tokens inject per request,
> the font pairing is a key, and presets (Session 4) prove the config bundle
> is portable — so this is the interface on top, not new rendering.
>
> Pick sections and order, swap the font pairing key, adjust tokens, preview
> on the platform subdomain, publish. Gated behind a call with a tech.
>
> **The non-negotiable guardrail: contrast is validated at *write* time, not
> build time.** The CI gate (D12) runs against whatever tokens existed when
> the build ran. A token write that would drive a tenant below AA is rejected
> at the point of the write, with a clear reason. Never a drag-and-drop page
> builder — that road ends at 200 sites you can't ship a global change to,
> the exact failure the architecture exists to prevent.
>
> **Acceptance:** a tech can restyle a tenant end to end through the editor;
> a write that fails contrast is rejected with a clear reason; no editor path
> can produce a broken or below-AA live tenant.

---

## SESSION E — ACTIVATE A SERVICE (run once PER service, when a client asks)

> **Do not run this pre-emptively.** Each stubbed service is activated the
> first time a paying client needs it — not before. Activating a service
> nobody's paying for builds a fake success path and an external account you
> now maintain for no one.
>
> When a client asks, activate exactly that one service, flip its flag (D19),
> and write its per-client activation steps into `RUNBOOK.md`. The
> demo/unconfigured state for every *other* tenant stays honest — never a
> fake success (D11).
>
> **Dependency reality, so you know what you're signing up for:**
>
> - **AI quote assistant** — code only, Anthropic API already in use.
>   Human-in-the-loop on trade quotes where a wrong number has real cost.
>   (Carried: ASSUMPTIONS #25 — needs a per-tenant price book.)
> - **CRM** — code only. Promote the leads inbox to a real pipeline
>   (statuses, notes, filtering), per-tenant, RLS-enforced.
> - **Booking** — code, but real: availability as a source of truth the
>   tenant owns, timezones and double-booking handled explicitly. No fake
>   slots. Genuinely fiddly — budget for it.
> - **Online payments** — Stripe **Connect Standard** (D7). Client is
>   merchant of record; chargeback liability stays with them. Per-client
>   Connect onboarding is a [YOU] runbook step. Unconfigured stays the honest
>   "call the shop to pay" callout.
> - **Call tracking / DNI** — needs real tracking numbers provisioned per
>   client. Assert the NAP invariant (§7 #6) as a test: the tracking number
>   appears in the rendered page only, never in schema, `llms.txt`,
>   citations, or GBP.
> - **Rank tracking** — pick the SERP vendor first (ASSUMPTIONS #64, still
>   carried; record the pick), implement `fetchLiveRanks()` in
>   `src/lib/growth/rank-tracking.ts`. Live mode currently throws naming
>   exactly this seam.
> - **GBP live reads** — OAuth refresh-token plumbing for the manager grant
>   (ASSUMPTIONS #65, carried — needs a real client's GBP grant to test
>   against).
> - **Missed-call text-back** — needs Twilio A2P *and* per-client ISV
>   registration (`ARCHITECTURE.md` §6). The biggest compliance lift of the
>   set — this is a client's business messaging that client's customers, so
>   it's per-client brand + campaign registration. Price it accordingly; it
>   is not a quick toggle.
>
> **Acceptance (per service):** it works end to end for the requesting tenant
> with RLS holding; any unconfigured tenant shows an honest not-live state;
> the per-client activation steps are in `RUNBOOK.md`.

---

## SESSION F — PRICING & PACKAGING RECONCILIATION

> Runs after anything in Sessions 3–E changes what's actually sellable. The
> billing engine is built in **Session 2 of this file** (the old premise that
> it already existed was false); this session only reconciles the ladder to
> reality. Pricing must map onto real feature flags (D19), never aspirational
> ones.
>
> **Do:**
> - Reconcile Curb / Curb+ / Curb Pro and à la carte add-ons against what's
>   actually live after Sessions 3–E. Anything sold corresponds to a flag
>   that does something real; anything not yet activated is labeled
>   "available on request" and gated behind its runbook step, not silently
>   sold.
> - Confirm every tier and add-on is a flag on the tenant record, enforced at
>   render and at billing sync, with buying one flipping exactly one flag and
>   no hand-provisioning.
> - Update the curbsidesites.com pricing narrative (Session 2) to match
>   reality to the letter — no feature named on the pricing page that isn't
>   live or honestly labeled as onboard-on-request.
> - Produce `PRICING.md` as the single source of truth: every plan, every
>   add-on, the flag each maps to, the service dependency each carries, and
>   the blended-MRR math updated for what actually ships. (This is a
>   deliberate exception to the eight-file map — record it in the map when it
>   lands.)
>
> **Acceptance:** every pricing-page line maps to a real flag; buying a plan
> or add-on in Stripe flips the right flags and provisions nothing by hand;
> `PRICING.md` and the marketing pricing page agree to the letter; no
> customer can pay for something that silently doesn't work.

---

## TRACEABILITY — every item from 00/01, accounted for

Statuses: **DONE** (built + verified, evidence noted) · **CARRIED** (lives in
a session above) · **PARTIAL** (split; both halves named) · **SUPERSEDED**
(replaced by this file's structure — nothing substantive dropped).

### From 00-BUILD-PROMPT.md

| Item | Status | Where |
|---|---|---|
| Session 1 — tenant app | DONE | `README.md`; `tests/rls-isolation.test.ts` (8/8); ASSUMPTIONS #1–32 |
| Session 2 — control plane | DONE | `src/lib/control/*`; migrations 002–004; ASSUMPTIONS #33–52 |
| Session 3 — growth plane | DONE | `src/lib/growth/*`; migration 005; ASSUMPTIONS #53–70 |
| Session 4 — runbook + production seams | DONE | `RUNBOOK.md` (+ appendices); production live; ASSUMPTIONS #71–82 |
| Session 5 — marketing site | CARRIED | Session 2 Half 1 |
| Session 5 — billing engine | PARTIAL | Webhook sync + dunning + human-gated suspension DONE (ASSUMPTIONS #42–44); products/Checkout/ACH/subscription-creation CARRIED → Session 2 Half 2 |
| Session 5 — live reveal (real-progress → verified-200 URL) | CARRIED | Session 2, text preserved in full |
| Session 5 — "not another multi-tenant client" guard | CARRIED | Session 2 Half 1 |
| Session 5 — honest-pricing rules | CARRIED | Session 2 + Session F |
| Session 6+ — pointer to 01 | SUPERSEDED | This file |

### From 01-BUILD-PROMPT.md

| Item | Status | Where |
|---|---|---|
| Preamble (invariants hold; D17 rule; session ordering + why) | CARRIED | This file's header + session order (hardening → cuts → presets → editor → activate → pricing preserved; marketing/billing inserted after hardening per Jason 2026-08-04) |
| Session A — behavior-frozen stabilization | CARRIED | Session 1 |
| Session A — review all ASSUMPTIONS entries | DONE | 2026-08-04 disposition pass (`ASSUMPTIONS.md`); code-side re-checks CARRIED → Session 1 |
| Session A — draft-content disclosure (full repro) | CARRIED | Session 1, verbatim |
| Session A — intake image sourcing / D11 miss / blob / credits | CARRIED | Session 1, verbatim + ASSUMPTIONS #31 refutation |
| Session A — apex-CNAME + registrar carry-forward bugs | CARRIED | Session 1, verbatim + settled as D22 (adds HTTPS-forward rule) |
| Session A — is_primary / export bugs | CARRIED | Session 1, verbatim + adds the unique-index constraint |
| Session A — dedup, types, migrations, tripwires, README truth pass | CARRIED | Session 1 |
| Session B — scope & design cuts | CARRIED | Session 3 (adds D25 deploy-caution) |
| Session C — industry presets (system + 5 presets + gallery + intake suggestion) | CARRIED | Session 4 (adds D21 ICP note) |
| Session D — theme editor (write-time contrast) | CARRIED | Session 5 |
| Session E — activate-a-service (per-service dependency notes) | CARRIED | Session E (adds rank-tracking + GBP from carried assumptions) |
| Session F — pricing reconciliation + PRICING.md | CARRIED | Session F (premise corrected: billing built in Session 2) |

### New in 02 (from the 2026-08-04 adversarial review — no prior home)

CI-green exit criterion + branch protection (D24) · origin trust boundary
(D23) · fixture noindex (D21) · deliverability registrable-domain fix +
apex-forward HTTPS (D22) · footer-credit 200s test (Inv. 11 note) ·
suspension-human-gate as tested invariant (ASSUMPTIONS #44) · [YOU] batch for
open decisions D26/D27/D28 · stale in-tree env-file deletion · Twilio filing
attached to Session 2 exit (was RUNBOOK Appendix B's orphaned "week after
Session 5" item).
