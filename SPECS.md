# SPECS.md — the three build specs, one file

Merged 2026-08-04 from three formerly separate files, content preserved:
**§I** = TENANT-APP.md (the multi-tenant renderer) · **§II** = CONTROL-PLANE.md
(onboard/provision/bill/watch) · **§III** = GROWTH-PLANE.md (the monthly report
and its instrumentation). Older documents and git history reference the old
filenames; each §'s internal "PART N" numbering is unchanged, so
"TENANT-APP.md Part 10" resolves to "SPECS.md §I Part 10".

Read `ARCHITECTURE.md` first — it holds every decision (D1–D28) and invariant
(§7). These specs reference decisions by ID rather than restating them; where
anything conflicts, `ARCHITECTURE.md` wins.

---

# §I — TENANT APP (Build Spec)

**The multi-tenant renderer.** One Next.js application that renders *any* Curbside Sites client from a database record.

Read `ARCHITECTURE.md` first — it holds every decision (D1–D20) and every invariant (§7). This document does not restate them; it references them. Where the two disagree, `ARCHITECTURE.md` wins.

**This is the only plane with revenue attached.** The first client ships on it.

---

## PART 0 — THE ONE RULE

**One codebase, N tenants, zero per-client code in core.** (D1)

If an implementation choice would require `if (tenant === 'california-motorsports')` anywhere in core, the choice is wrong — even when it's convenient, even when it's faster, even when it's just this once.

There is exactly one sanctioned escape hatch, in Part 5 (D17). Use it or find another way.

---

## PART 1 — WHAT THIS IS

A single Next.js app (latest stable, App Router, TypeScript, `src/`) that resolves a tenant from the `Host` header, loads that tenant's config, brand, content, and integration state from Postgres, renders a fast, accessible, SEO-correct site for a local service business, and falls back to demo data for anything unconfigured *or* broken without ever breaking a page.

The customer of this app is a truck owner standing in a parking lot looking at his lifted F-250, deciding whether to call. **The customer of the codebase** is the next contributor — human or AI — who must extend it having read nothing but the README.

---

## PART 2 — TENANCY & THE REQUEST LIFECYCLE

Middleware reads `Host`, resolves it to a tenant via the `domains` table, and attaches a `TenantContext`. Cache the hostname→tenant lookup aggressively; it changes approximately never.

**Three hostname states, all of which must work:**
- `californiamotorsports.com` — the live custom domain.
- `california-motorsports.sites.curbsidesites.com` — **the platform subdomain. Works the moment the tenant row exists.** This is how a shop owner sees their finished site before touching DNS or paying anything beyond the deposit, and it is most of Curbside's sales leverage. It is a first-class hostname state, not a fallback.
- Unknown host → a clean 404, not a broken tenant page.

**Tenant status gates rendering:**
- `draft` — platform subdomain only, `noindex`, visible to staff and a preview token.
- `live` — everything on.
- `suspended` — the "under construction" page. This is the non-payment and offboarding state (D20). One field flip. Dignified, not broken.

---

## PART 3 — DATA LAYER

Postgres per D3. Migrations in-repo, versioned, forward-only. Zod schemas are the single source of truth for shape, shared between DB write validation, Server Actions, and the client.

**Row-Level Security per D4 — read it, it is the highest-severity risk in the platform.**

Implementation requirement: **write the data-access layer so that acquiring a tenant-scoped client and opening a transaction are the same operation and cannot be done separately.** If a caller can get a DB handle without a tenant context, someone eventually will.

CI test: attempt a cross-tenant read from application code. Then attempt it again with a deliberately malformed query that omits the tenant filter. **Both must return zero rows.** If application code is the only thing preventing the leak, the build is not done.

Demo data per D5.

---

## PART 4 — CONFIG → RENDER

The propagation guarantee is D2. There is no config file; the tenant record is the source of truth.

**Rendering:** ISR with on-demand revalidation, **cache-tagged per tenant** (`tenant:<slug>`). A config write revalidates only that tenant. A content write revalidates only the affected routes. One shop editing their hours must never invalidate 199 other shops' caches.

---

## PART 5 — THE SECTION REGISTRY

Per D17. Core exposes a registry of named, typed sections — `hero`, `services-grid`, `gallery`, `reviews`, `cta-band`, `faq`, `contact`, and so on. The tenant's `sections` rows declare which render, on which page, in what order, with what props.

Every section must be **safe to enable in any order with any data.** A section toggled on with nothing behind it degrades to a sensible empty state, never a broken layout.

---

## PART 6 — BRANDING PER TENANT

### Colors: tokens from the database, injected at request time

The tenant's `brand` record holds semantic tokens (`--brand`, `--brand-dark`, `--surface`, `--surface-raised`, `--ink`, `--ink-muted`, `--edge`, `--accent`). Emit them as CSS custom properties in a `<style>` block in that tenant's `<head>`. Tailwind utilities reference `var(--brand)`.

**No raw hex anywhere in a component. Ever.** Every color in the entire app resolves through a token. This is what lets one codebase render 200 distinct brands.

### Fonts: a curated set, chosen by key — read this, it will bite you

**`next/font` resolves at build time.** It cannot take a font name out of a database at request time. Attempting it either fails the build or silently ships a fallback that nobody notices until a client asks why their site is in Arial.

So: ship a **curated set of 8–12 font pairings** (a display face plus a body face each), all loaded via `next/font` at build time and exposed as CSS variables. The tenant's `brand.font_pairing_key` picks one **by key**. Adding a pairing is a one-line core change that benefits every tenant — exactly the shape D17 wants.

This constrains brand expression slightly and eliminates an entire class of build failures and layout shift. Correct trade.

### Design direction

Do **not** produce the default AI-agency template: centered hero with a gradient blob, three feature cards with lucide icons, a testimonial carousel, a big CTA band. **If a rendered tenant could belong to a SaaS startup with the logo swapped out, it is wrong.**

Sections must be capable of taking a real position — heavy, dark, high-contrast, mechanical for an off-road shop; something else entirely for a different trade. Big confident type. Real photography. Layouts that feel engineered: visible grid, deliberate asymmetry, generous negative space. Motion restrained and physical — weight and momentum, never bouncy.

**Mobile-first, always.** The customer is standing in a parking lot. Tap-to-call must be reachable with a thumb on every screen.

---

## PART 7 — ADAPTERS & DEMO MODE

Implement D11 exactly. **The bar in D11 is the acceptance test for this entire build:** a brand-new tenant with zero integrations must produce a fully browsable, screenshot-ready site, and configuring each integration must light it up with zero code changes.

`GET /api/status` (staff-authenticated) returns each tenant's integration states plus the **names** of required secrets — never values (Invariant 3). That endpoint is the go-live checklist: fill in a key, hit it, watch the flag flip.

---

## PART 8 — FEATURES

### Active

- **Pages:** Home, Services (anchored sections per service), About, Gallery, Contact, Blog index + posts. All section-composed, all config-driven.
- **Blog** (D18): DB-backed, typed frontmatter validated by Zod on write. Tag filtering, reading time, RSS at `/feed.xml`, auto-generated OG images via `next/og`. Drafts hidden in prod. Publishing = a DB write plus a revalidation, never a deploy.
  - Slugs regex-guarded: `^[a-z0-9-]+$`.
  - Dates stored as plain `YYYY-MM-DD`, **rendered pinned to a fixed noon time.** Never `new Date("YYYY-MM-DD")` — it renders the wrong day in every western timezone, and it will surface three months from now as "your blog says the wrong date."
  - Launch each tenant with 2–3 real, useful articles in the owner's voice. Never lorem ipsum. They are SEO surface *and* they demo the blog to the client.
- **Quote / info request form:** service type, vehicle or boat details, photo upload (to Blob Storage), preferred contact method. Zod-validated, shared client and server. **Server Actions, not API routes.** Honeypot + rate limit. Writes to `leads`.
- **Newsletter signup** — adapter. Honeypot + rate limit.
- **Reviews** — read from *our* cached rows (D10). Aggregate rating displayed; JSON-LD gated by Invariant 7.
- **Click-to-call, click-to-map, sticky mobile call bar.**
- **Instagram feed** — adapter, demo fallback.
- **Analytics** — adapter; no-ops when unconfigured. Conversions write to `events` (D14).
- **Client portal:** magic-link auth, tenant-scoped (D16). Leads inbox, content editing, hours/services editing, and the **change-request chat** (D9) behind a `ChangeRequestChannel` interface so SMS is a later config flip.

### Stubbed — fully typed, wired to demo data, marked `// TODO: LIVE`

These are **the price list** (D19), not scoping compromises. A client must be able to *see* each one working before they buy it.

- **Payments** — Stripe Connect Standard interface (D7). Demo mode returns an explicit, friendly "online payments aren't live yet — call the shop to pay" callout with the phone number. **Never a fake success** (it's a real invoice) and never an error.
- **Booking** with availability slots.
- **Customer portal shell** — job status ("your lift kit is in progress"), quote history.
- **AI quote assistant** — chat widget, intakes a job description, returns a ballpark. Demo returns canned responses.
- **Call tracking** — DNI in the rendered page only, per Invariant 6.

---

## PART 9 — SEO & DISCOVERABILITY

This is the client's marketing budget. Treat it like one. Build for two readers: Google's crawler, and the LLM that gets asked "who does boat service near me."

All of it generated from the tenant record (D2). Nothing hand-maintained.

- `metadataBase` per tenant. Title template (`%s | Business Name`). Unique descriptions leading with service + city + phone. One `h1` per page, semantic heading order, descriptive alt text on every image.
- OpenGraph + Twitter cards everywhere; posts get `type: article`. Canonical URLs on everything.
- Human-readable slugs matching search intent (`/services#lift-kits`, `/blog/choosing-the-right-lift-kit`).
- `sitemap.ts` per tenant — every page and post, `lastModified` from the record. New content appears with zero extra steps.
- `robots.ts` — allow all, disallow `/portal` and `/api/`, point at the sitemap. `/portal` also gets page-level `noindex`.
- **`llms.txt`** — a readme for robots. Plain markdown at the tenant root: what the business does, every service with a one-line description, NAP, hours, service area, links to key pages. AI assistants increasingly answer "who should I call" from exactly this. It costs one static route.
- Favicon set + web manifest per tenant.

**JSON-LD**, built from the record:
- `LocalBusiness` with the **most specific** applicable subtype (`AutoRepair`, not generic `LocalBusiness`), full NAP, geo, `openingHours`, `sameAs`.
- A `Service` entry per service.
- `Article` on posts. `FAQPage` wherever FAQ content exists — and it should, because FAQ content is what LLMs and featured snippets quote.
- `aggregateRating` per Invariant 7.

**Performance is SEO.** Core Web Vitals are a ranking input. `next/image` everywhere, `priority` on the hero, correct `sizes`, fonts via `next/font` (no layout shift, no FOIT), no CLS from undimensioned media.

**The Curbside footer credit** per Invariant 11 — anchor text varies per tenant.

---

## PART 10 — IMAGES

**Do not invent image URLs. Do not guess Unsplash or Pexels file IDs.** Any hardcoded remote URL you have not verified will 404, and you will have shipped a broken site to someone's business.

1. `images` rows per tenant: `slot_id`, `purpose`, suggested search query, required aspect ratio, alt text, url, credit.
2. Ship every tenant with locally generated **SVG placeholders** in that tenant's brand palette at the correct aspect ratio, so the layout is right and nothing 404s. **A tenant with zero uploaded images must still look finished.**
3. Real images live in Azure Blob Storage, served through `next/image` with `remotePatterns` configured.
4. A sourcing script reads the manifest and fetches candidates — **and a human looks at every image before it ships.** Reject on sight: another business's name or phone painted on a vehicle, readable plates, wrong region (lush jungle for a desert brand), wrong subject class (sports-car wheel for a truck shop), cluttered amateur settings, a vibe that fights the brand. Expect to reject a third to half. Winners are renamed to their slot (`hero-desert-truck.jpg`) so the client can later drop in their own photo under the same name with zero code edits. Record source links in credits.
5. **Photos never carry text directly.** Every placement gets a dark overlay or gradient between image and copy, tuned per image, heavier at the text edge. The layout must survive any image being swapped. Prefer compositions that tolerate cropping at multiple breakpoints.
6. **Real photos of a lifted F-250 in the client's own bay outperform any stock image**, and they already post them — which is why onboarding asks for their photos and their Instagram. Stock is genuinely right for abstract textures, backgrounds, and lifestyle context, and actively harmful for fake "our work" shots, which are trust poison.

---

## PART 11 — ACCESSIBILITY, PRIVACY

Accessibility per D12 — a build gate, run per tenant against that tenant's real tokens, failing the build on violation.

Privacy and legal per D13 — generated per tenant, never pasted.

---

## PART 12 — STATIC FAILOVER EXPORT

Implement D6. The export job lives here; the alerting surface lives in the control plane.

---

## PART 13 — DELIVERABLES

1. Complete file tree.
2. All files, in dependency order.
3. Migrations, including RLS policies, plus a seed script producing a realistic demo tenant.
4. Key Vault secret manifest — every secret, grouped, each with **what it does, where to get it, and what breaks without it.**
5. `README.md`, written as a **handoff document for the next contributor, human or AI**, who must continue from this one file with no other context:
   - Quickstart
   - The tenancy and demo/live architecture, explained once, with a table: feature → required config → live behavior → fallback behavior
   - A directory map with the 4–5 most-edited files starred
   - Recipes: onboard a tenant, publish a post, change hours, add a service, swap a photo, add a font pairing, add a section
   - Where every visual token lives
   - A go-live runbook per integration, in priority order
   - "What to build next" — each stub named, with the exact seam to extend
   - Conventions to preserve
   - **Gotchas** — everything that will silently waste the next person's hour: `SET LOCAL` vs `SET` under pooling, `next/font` being build-time, the `new Date("YYYY-MM-DD")` timezone trap, cache-tag scoping, Blob CORS, ISR windows
6. `ASSUMPTIONS.md` — every decision made without asking, including every service choice left open in D3. **Do not stop to ask clarifying questions mid-build. Make the call, log it.**

Prioritize a small number of exceptionally well-executed pages over broad, shallow coverage. If scope must be cut to protect quality, **cut from the stubbed list and say so in `ASSUMPTIONS.md`.**

---

## PART 14 — ROADMAP: DESIGN AS CONFIG (not v1)

Noted so the seam is built correctly now, even though the interface comes later.

**The primitives already exist.** Sections are config (Part 5). Brand tokens come from the database and inject per request (Part 6). The font pairing is a key. So "toggle a section, swap the display font, warm the palette" is *already* a DB write plus a revalidation — no deploy, no code change. What's missing is only the interface on top.

Build it later as a **staff-gated theme editor** in the control plane: pick sections and order, swap the font pairing key, adjust tokens, preview on the platform subdomain, publish. Gated behind a call with a tech — not because clients can't be trusted with a color picker, but because they can, and the result becomes a page in Curbside's portfolio.

**The guardrail that is not optional: contrast must be validated at write time, not build time.** The CI gate (D12) runs against whatever tokens existed when the build ran. Someone adjusting `--ink` against `--surface` at 9pm can drive a live tenant below AA without tripping a single check, because no build happened. So **any token write validates contrast across every pairing the design system actually uses and rejects the write if it fails.** Otherwise the theme editor is a lawsuit generator wired directly to production.

**Resist the drag-and-drop page builder.** That road ends at 200 sites you can no longer ship a global improvement to — the exact failure this architecture exists to prevent.

---

## PART 15 — VERIFY BEFORE HANDOFF

"It compiles" is not done.

1. **`next build` passes clean.** Treat it as the typecheck gate.
2. **Cross-tenant isolation, first and loudest.** Per Part 3. Seed two tenants; both attack paths must return zero rows.
3. **Boot the production server** (`next start`, not dev) and smoke-test with real HTTP requests **against two tenants on two hostnames**, asserting each one's content and *not* the other's:
   - every page 200s
   - every form POST returns its expected demo payload
   - reviews serve from cache, and no vendor API is called at request time
   - the payment stub returns its "not live yet" callout — not a fake success, not an error
   - the portal loads and honors auth
   - `/sitemap.xml` lists every page and post **for that tenant only**
   - `/robots.txt` points at the right sitemap; `/llms.txt` serves
   - the JSON-LD in rendered HTML parses as valid JSON and emits **no** `aggregateRating` while reviews are demo
4. **Prove the persistence loop.** POST a test lead; confirm it appears in that tenant's portal and **nowhere else**. Then **delete the test records** — the client's first look should show polished demo data, not "Smoke Test."
5. **Prove the unconfigured-tenant bar (D11).** Create a tenant with zero integrations. It must render a complete, screenshot-ready site on its platform subdomain. Configure one integration; watch exactly that one flip live.
6. **Confirm every image in rendered HTML actually serves** (200, `image/jpeg` or `webp`) through the image optimizer, not just from disk.
7. **Run axe against every rendered page of both tenants, with their real tokens. Zero violations.**
8. **Kill every server you started and verify the port is free.** On Windows especially, stopping the npm wrapper can orphan the node child, which keeps serving a **stale build** and corrupts the next verification pass.
9. **Report verification results honestly** in the final summary: what was exercised, what passed, and anything skipped or unverified. **Do not describe a check you did not run.**


---

# §II — CONTROL PLANE (Build Spec)

**The machine that turns a prospect into a live Curbside Sites tenant, and keeps 200 tenants observable.**

Read `ARCHITECTURE.md` first — it holds every decision (D1–D20) and invariant (§7). This document references them rather than restating them.

---

## PART 0 — THIS DOCUMENT WILL CHANGE

Written before there are clients. It is therefore partly wrong, in ways only real clients can reveal.

**The dashboard in Part 6 is a guess.** The panel you actually reach for at 8pm on a Tuesday will not be the one anyone predicted. Build it, ship it, then rewrite it. That is normal; platforms get rewritten. **When reality contradicts this document, change this document** and leave a one-line note saying what changed and why.

---

## PART 1 — WHAT THIS IS

Staff-only, plus **one public surface**: the onboarding intake form.

Four jobs: **onboard**, **provision**, **bill**, **watch**.

Nothing here renders to the public. If a feature faces a *client's customer*, it belongs in the tenant app.

---

## PART 2 — THE ONBOARDING PIPELINE

The most important part of the control plane. **It is what makes client #2 cheap.**

### 2.1 The intake form (public, on curbsidesites.com)

Collects:
- Business identity: name, address, phone, hours, service area, socials
- The mark: logo upload, business card, any existing brand assets
- Services: name + short description, repeatable
- Photos: direct upload, plus their Instagram handle
- Voice: how they'd describe what makes them different, in their own words
- **Registrar: which registrar they use — the name only** (D8)
- Add-ons: checkboxes (CRM, online payments, booking, blog, SEO, monthly reporting, call tracking)
- **Consents** — see 2.2

**The form's output is not a document or an email. It is database rows.** It writes a `draft` tenant plus `business_profile`, `services`, `brand` (assets, unprocessed), `images`, and `sections` rows, and it sets the `integrations` flags **directly from the checkboxes.**

That is the whole trick: **the intake form and the build pipeline are one system.** The checkboxes *are* the feature flags (D19). There is no transcription step, because a transcription step is where a person gets involved and the margin dies.

### 2.2 Consent — do not skip this, and do not treat it as boilerplate

Curbside records the onboarding call, transcribes it, stores the transcript, and uses it as an AI voice reference for content generation for the life of the account (2.4, and `SPECS.md §III` Part 5). That requires explicit, specific, documented consent.

**California is an all-party consent state** (Penal Code §632). Recording a confidential communication without the consent of every party is a crime, not merely a civil problem, and it is not cured by a checkbox nobody read.

So:

1. **Written consent at intake.** A distinct, separately-checked consent — never bundled into the terms-of-service checkbox — that plainly states: the onboarding call will be recorded; the recording will be transcribed; the transcript and recording will be processed by a third-party AI service (name it); the transcript will be used to generate marketing content in their voice; how long it's retained; and how to withdraw consent and have it deleted.
2. **Verbal consent at the top of the call, captured in the recording itself.** Say it plainly, ask them to confirm, and do not begin substantive discussion until they have. If a second person joins the call, get theirs too — all-party means all parties.
3. **A hard stop:** if consent is not given, the call proceeds unrecorded. Notes only. The pipeline must work without a transcript, degrading to the intake form's free-text voice field. **A missing transcript is an inconvenience; an unlawful recording is an existential problem.**
4. Consent state is a **field on the tenant record**, not a filing cabinet. The content pipeline reads it and refuses to run against a transcript that has no recorded consent.
5. Withdrawal deletes the recording and the transcript, and the content pipeline falls back to the free-text voice field.

Get a lawyer to review the consent language before the first call. This is a paragraph of text and an hour of billable time, and it is the cheapest insurance in the whole business.

### 2.3 The brand gate (human approval — do not automate this one)

From the uploaded mark, propose:
- A semantic token palette (`--brand`, `--brand-dark`, `--surface`, `--surface-raised`, `--ink`, `--ink-muted`, `--edge`, `--accent`) with exact values pulled from the asset.
- A **font pairing key** from the curated set (`SPECS.md §I` Part 6 — fonts are build-time; you pick a key, not a font).
- Texture and material notes: what the asset's finish implies, and how to evoke it in CSS without skeuomorphing it.
- A "do not do" list: the specific ways this brand could be made to look cheap.

**Render the proposal, stop, and wait for approval before the tenant leaves `draft`.** This is the one gate where taste is unrecoverable and five minutes of a human looking saves a client relationship. Automate everything else; do not automate this.

### 2.4 The 30-minute call

Booked automatically after the form. Recorded **only under the consent regime in 2.2.**

It is where you catch what the form can't surface, and where the retainer gets sold. It is the highest-leverage half hour in the business. Do not try to automate it away.

### 2.5 Preview, then domain, then live

- The tenant is **immediately browsable** at `<slug>.sites.curbsidesites.com` in `draft`, `noindex`. This is the sales artifact — a finished site, shown before they've touched DNS.
- Domain (D15): create the **Cloudflare Custom Hostname** via API, generate **registrar-specific** nameserver instructions (they use GoDaddy → give them GoDaddy screenshots, not generic advice), poll verification, notify both sides when it lands. **Clients are slow at this. Chase automatically, not manually.**
- Flip `draft → live` when the domain verifies and the brand gate has passed.

### 2.6 Content seeding

AI drafts site copy and 2–3 blog posts in the owner's voice, each targeting one long-tail local query. **Human review before publish, always** — see `SPECS.md §III` Part 6 for why that gate is not negotiable.

---

## PART 3 — SECRETS

Azure Key Vault per D3 and Invariant 3.

- Naming convention: `tenant-<slug>-<integration>-<key>`. The `integrations` row stores `kv_secret_ref`, never a value.
- Rotation policy per integration, with an expiry warning surfaced on the dashboard **before** the key dies rather than after.
- **Whose key is it?** If a client's Google API key sits under Curbside's account, Curbside owns their billing and they own a portability problem. Record `key_owner` on the integration row and prefer client-owned keys wherever the vendor allows it.

---

## PART 4 — BILLING

Stripe Billing per D7. Plans and add-ons per D19 — **and every plan and add-on is a feature flag, never hardcoded logic.** Buying an add-on flips a flag; there is no separate provisioning step.

Webhooks sync subscription status → `billing` and `tenants.plan_tier`.

### The suspension path needs a human gate

Non-payment eventually sets `tenants.status = suspended`, which serves the under-construction page (D20). That behavior is in the MSA and disclosed cheerfully up front.

**But do not let a webhook silently kill a real business's phone line over a $2 card decline.** The path is: failed payment → automated retries → warning emails at day 3, 7, 14 → **a human confirms suspension.** The automation prepares the action; a person takes it.

This is the one place where being *less* automated is unambiguously correct, and the reason is that the cost of a false positive lands on someone else's livelihood, not on ours.

---

## PART 5 — THE ALARM THAT MATTERS MOST

**A form that has stopped delivering.**

It is the perfect silent failure: the site is up, every page returns 200, the form appears to submit, and the leads go nowhere. The shop owner doesn't call. They quietly conclude the website doesn't work and churn at renewal without ever telling you why.

So:
- **Alert on zero form submissions in 14 days** on any tenant that previously had a baseline.
- Run a **synthetic end-to-end submission** on a schedule: post a lead, confirm it lands in the right tenant, confirm the notification email is *delivered*, delete it.
- **Monitor email deliverability per domain** — SPF/DKIM/DMARC checks plus a scheduled test send (`ARCHITECTURE.md` §6).

Deliverability is not a nice-to-have panel. It is the thing that quietly kills the business.

---

## PART 6 — THE FLEET DASHBOARD

**A guess. Build it, then rebuild it once four clients have taught you what you actually look at.**

One table, one row per tenant, sorted by what's on fire:

| Signal | Why |
|---|---|
| Status (`draft` / `live` / `suspended`) | |
| Uptime + **failover events** (D6) | A silent failover lasting a week is a site we *believe* is live and isn't |
| **Form submissions, last 7 / 30 days** | Part 5 |
| **Email deliverability** per domain | Part 5 |
| Core Web Vitals | Performance is a ranking input, so it's a product metric |
| Error rate; `last_error_at` per integration | Surfaces the dead API before the client finds it |
| Integration states (live/demo) | The go-live checklist, fleet-wide |
| Billing status, MRR | |
| Last content update; open change requests | Is the SEO tier actually delivering? |
| Secret expiry warnings | Before the key dies, not after |

---

## PART 7 — DEPLOY ORCHESTRATION

Environments per `ARCHITECTURE.md` §5. Health checks are semantic, not status-code (Invariant 9). **Rollback is one action, reachable from a phone.**

---

## PART 8 — THE CHANGE-REQUEST QUEUE

The portal chat (D9) produces typed diffs the *client* confirms. Most never touch staff.

What lands here:
- Requests the AI couldn't map to a typed diff
- Anything the client marked urgent
- Custom-work requests → a quote, a line item, and a care-plan bump (D17, D19)

Everything logged with the original message as the audit record. The human in this queue is Jason until there's a tech.

---

## PART 9 — OFFBOARDING

Per D20. The sequence:

1. `status = suspended` → under-construction page.
2. Generate the **exit report** — the same artifact as the monthly report (`SPECS.md §III` Part 5). Build it once.
3. Release the domain. They keep it, always. Remove the Cloudflare Custom Hostname; hand back clean nameserver instructions.
4. Purge their secrets from Key Vault.
5. Delete their recording and transcript. Retain remaining data per the stated retention window, then delete it. **What the privacy policy says is what actually happens.**

---

## PART 10 — AUTH & ROLES

Per D16. Two surfaces, never conflated. A staff session must never leak into a tenant-scoped context.

---

## PART 11 — DELIVERABLES

1. File tree; all files in dependency order.
2. Migrations for control-plane tables; **a seed script producing a realistic demo fleet** (~6 tenants in mixed states — draft, live, one failing integration, one suspended, one with zero form submissions — so the dashboard has something real to show).
3. Key Vault secret manifest: every secret, what it does, where to get it, what breaks without it.
4. `README.md` as a **handoff document** for the next contributor, human or AI, continuing from this one file with no other context: quickstart; the onboarding pipeline explained once, end to end; recipes (onboard a tenant, provision a domain, rotate a secret, suspend and restore, offboard); the go-live runbook; conventions to preserve; and a gotchas section for everything that will silently waste the next person's hour.
5. `ASSUMPTIONS.md` — every decision made without asking. **Do not stop to ask clarifying questions mid-build. Make the call, log it.**

---

## PART 12 — VERIFY BEFORE HANDOFF

1. `next build` passes clean.
2. **Run the full onboarding pipeline end to end against a fake business.** Form → draft tenant → brand proposal → approval gate → previewable site on the platform subdomain. **If a human has to touch a database to make that work, the pipeline isn't done.**
3. **Prove no endpoint returns a secret value.** Grep the responses, not just the code.
4. Confirm the content pipeline **refuses to run** against a transcript with no recorded consent (2.2).
5. Suspend a tenant; confirm it serves the under-construction page and nothing else. Restore it; confirm it comes back intact.
6. Simulate a failed payment; confirm it produces warnings and a **pending human action**, not an automatic suspension.
7. Break an integration deliberately; confirm the tenant app falls back to demo, the dashboard shows `last_error_at`, and **no other tenant is affected**.
8. Kill a tenant's form delivery; confirm the zero-submissions alarm fires.
9. Kill every server you started; verify the port is free.
10. **Report verification results honestly.** What was exercised, what passed, what was skipped. **Do not describe a check you did not run.**


---

# §III — GROWTH PLANE (Build Spec)

**The system that proves the retainer is worth paying.**

Read `ARCHITECTURE.md` first — it holds every decision (D1–D20) and invariant (§7). This document references them rather than restating them.

---

## PART 0 — THIS DOCUMENT WILL CHANGE

Written before a single client has read a monthly report. The first time one does, they will ask a question this spec doesn't answer, and the report will need rebuilding around it. That's the point of shipping it.

**When reality contradicts this document, change it,** and leave a one-line note saying what changed and why.

---

## PART 1 — THE PREMISE, PLAINLY

Curbside charges a shop owner $199 to $1,499 every month, forever. **Every month, that shop owner decides again whether to keep paying.**

He decides based on one question: *did this produce jobs?*

He will not answer it by looking at his analytics. He will answer it by feel — and if he has no evidence, "feel" defaults to *no*, because the invoice is concrete and the benefit isn't. That is how agencies churn: not because the work was bad, but because the client couldn't see it.

**So the growth plane's job is to produce the evidence.** Its actual product — the thing the client consumes — is one document a month that answers his one question with a number he trusts.

Everything else in this file exists to feed that document:

| Component | Why it's here |
|---|---|
| Review aggregation (Part 2) | Reviews are a number he watches, and they feed the site's social proof |
| Conversion events (Part 3) | Calls, forms, direction taps — **this is "did it produce jobs," instrumented** |
| Call tracking (Part 4) | Turns "the phone rang" into an attributable number he can *feel* |
| **The monthly report (Part 5)** | **The product.** Everything above is instrumentation for it |
| Content pipeline (Part 6) | The recurring labor the SEO tier is actually buying |
| Local visibility ops (Part 7) | Where the jobs actually come from in this market |
| Rank tracking (Part 8) | Leading indicator; supporting evidence in the report |

**Build the report first, then build what it needs.** If you build the instrumentation first you will instrument things nobody asked about.

---

## PART 2 — REVIEW AGGREGATION

Per D10: no tenant app request ever calls a vendor API. Scheduled jobs fetch for all tenants and write to `reviews`; tenants read our rows.

- Sources: **Google Places API (v1)** and **Yelp Fusion API**. Plain `fetch` against REST — each is one call, and an SDK buys nothing but version lock.
- **Staggered across the window, not daily.** At 200 tenants, daily pulls against Yelp's free tier is a quota wall hit at exactly the wrong moment. Weekly-to-monthly per tenant, spread across the calendar. A review that shows up nine days late has cost nobody anything.
- Exponential backoff. A quota-aware scheduler that degrades gracefully rather than failing a batch.
- Failures write `last_error_at` and fall back to existing cached rows (D11).

`aggregateRating` JSON-LD per Invariant 7.

---

## PART 3 — CONVERSION EVENTS

Per D14. The `events` table records, per tenant: `call_tap`, `form_submit`, `map_tap`, `newsletter_signup`, `booking_started`, `booking_completed` — each with source attribution (organic, direct, GBP, Instagram, referral).

**That is the conversion set.** Everything else is a supporting metric that never appears in front of a client.

---

## PART 4 — CALL TRACKING (interface now, live later)

The single most retainer-justifying product available to these businesses, because it converts the work into a number they *feel*: the phone rang, and here's why.

**Dynamic number insertion in the rendered page only**, per Invariant 6. Define the adapter now, ship it behind a flag, and **assert the NAP invariant as a test, not a note.**

---

## PART 5 — THE MONTHLY REPORT

**The product. Build this first.**

One artifact, two jobs:
- The **retention mechanism** — "the site produced 47 calls last month" is what makes a $749 invoice feel cheap.
- The **exit report** (D20) — the same document, with the numbers ending, handed to a departing client.

Generated as a PDF, emailed, and rendered in the client portal.

### What it says

**Lead with the number that matters: how many people tried to contact you this month.** Calls, form submissions, direction requests. One big number, then the breakdown. **A shop owner must get the point in 60 seconds, standing up, on a phone.**

Then:
- Where those people came from
- Month-over-month trend; same-month-last-year once there is one
- Reviews: count, rating, movement
- Search visibility: queries won, movement on tracked terms
- **What Curbside shipped this month** — posts published, changes made, issues fixed
- **What's next month** — one or two lines

### The honesty rule (Invariant 12)

**Never inflate. Never pad a thin month with a vanity metric.**

If the month was bad, the report says so, says why if we know, and says what we're changing.

A report engineered to look good in a bad month is a report the client stops believing, and the day they stop believing it is the day the retainer becomes a line item to cut. **The report's entire value is that it is credible.** That is also the honest constraint on this whole business: if the work doesn't produce jobs, the report will show it — and it should.

---

## PART 6 — THE CONTENT PIPELINE

The recurring labor behind Curb+ and Curb Pro (D19).

- **Voice reference:** the onboarding call transcript (`SPECS.md §II` §2.4), **usable only where consent is recorded on the tenant** (§2.2). No consent → fall back to the intake form's free-text voice field. The pipeline must check this and refuse, not assume.
- **One post, one long-tail local query.** "Leveling kit vs lift kit." "Annual boat service checklist." Genuinely useful answers — that's the whole organic surface area, and it's what LLMs and featured snippets quote.
- **Internal-link every post** to the relevant service section and the contact page. This is where SEO compounds and it's the step everyone skips.
- Publishing is a DB write plus a revalidation (D18). Never a deploy.

### Human review before publish. Always.

Not because AI content is inherently bad, but because:
- Unhelpful content gets penalized, and a plausible-sounding post that says nothing is unhelpful.
- **These are trades.** A confidently wrong maintenance interval on a boat engine, or a wrong torque spec on a lift kit, is not an SEO problem. It is a safety problem, published under a real person's business name, with their phone number on it.

One person reads every post before it goes out. **This is not a bottleneck to optimize away.**

---

## PART 7 — LOCAL VISIBILITY OPS

- **Google Business Profile:** posts, hours sync, category management, Q&A. Manager access, never their login (D8).
- **Review solicitation:** a flow that asks happy customers at the right moment. Highest-ROI thing in local SEO, and mostly a timing problem.
- **NAP drift monitor.** An automated check that the canonical NAP still matches GBP and the major directories. **Drift is silent and costs rankings without ever producing an error** — a client edits their hours on GBP directly, or a directory rewrites their suite number, and nobody notices for six months. Cheap to build, and it's the kind of thing that makes a client believe you're actually watching.

---

## PART 8 — RANK TRACKING

A modest set of tracked terms per tenant (service + city), refreshed weekly, feeding the report's search-visibility section. **Modest is the operative word:** twenty terms that matter beats two hundred that don't, and the report only has room for movement worth mentioning.

---

## PART 9 — DELIVERABLES

1. File tree; all files in dependency order.
2. **The report generator, with a seeded example rendering realistic data** — the kind you could actually hand a prospect.
3. Job scheduler, with the staggering and quota logic explicit and testable.
4. `README.md` as a handoff document: how jobs are scheduled, how the report is assembled, how to add a metric, and a gotchas section (API quotas, timezone traps at monthly boundaries, what happens on a partial-data month).
5. `ASSUMPTIONS.md` — every call made without asking. **Don't stop to ask mid-build.**

---

## PART 10 — VERIFY BEFORE HANDOFF

1. `next build` passes clean.
2. **Generate a full monthly report for a seeded tenant and read it as if you were the shop owner.** Does the first number answer *"did this make me money?"* If not, the report is wrong regardless of whether it renders.
3. Confirm **no vendor API is called at request time** by any tenant page. Not one.
4. Simulate a quota failure mid-batch: confirm graceful degradation, cached rows still served, `last_error_at` recorded, **other tenants unaffected.**
5. Confirm `aggregateRating` is absent from rendered JSON-LD while review rows are `is_demo`, and present once live rows exist.
6. Confirm DNI never alters the NAP in JSON-LD, `llms.txt`, or any generated citation string. **Assert it as a test.**
7. Confirm the content pipeline refuses to use a transcript with no recorded consent.
8. Run the report across a month with missing data; confirm it **degrades honestly** rather than rendering zeros as achievements.
9. **Report verification results honestly.** What was exercised, what passed, what was skipped.
