# TENANT-APP.md — Build Spec

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
