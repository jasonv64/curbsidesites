# ARCHITECTURE.md

**Curbside Sites — multi-tenant website platform for local service businesses.**
Status: decision record. Owner: Jason.

This is the **single source of truth for decisions**. The build specs in `SPECS.md` (§I tenant app, §II control plane, §III growth plane) reference decisions here by ID (D1, D2, …) rather than restating them. If a build spec contradicts this file, this file wins — or this file gets amended first, deliberately.

### The document map (amended 2026-08-04 — this section used to say "four documents and no others"; eight build sessions later that was false and hiding drift, so the set was consolidated to eight)

| Document | Role | Wins on |
|---|---|---|
| `ARCHITECTURE.md` | Decision record (D1–D28) + invariants (§7) | **Decisions.** Nothing overrides a settled D-entry except a deliberate amendment here. |
| `SPECS.md` | The three build specs — Part I tenant app, Part II control plane, Part III growth plane (formerly `TENANT-APP.md` / `CONTROL-PLANE.md` / `GROWTH-PLANE.md`, merged verbatim 2026-08-04) | How to build what the decisions require |
| `ASSUMPTIONS.md` | Mid-build calls, numbered, each with a disposition | The record of why something differs from the spec |
| `RUNBOOK.md` | Platform operations, plus Appendix A costs, Appendix B calendar-time items, Appendix C the secrets manifest (formerly `COSTS.md` / `CALENDAR.md` / `SECRETS.md`, merged 2026-08-04) | **As-built facts.** Where the deployed system differs from a spec's description, the RUNBOOK "as built" table is the truth and the spec gets amended. |
| `ONBOARDING.md` | Per-client procedure, written from a real onboarding | Per-client reality, known gaps |
| `README.md` | Contributor handoff | Code-level conventions and gotchas |
| `02-BUILD-PROMPT.md` | The forward build plan (supersedes `00-`/`01-BUILD-PROMPT.md`, which live in git history) | Session sequencing |
| `HANDOFF.md` | Session-to-session state | What is proven vs. assumed right now |

Precedence, in one line: **decisions here → as-built facts in RUNBOOK → specs → prompts.** A fact lives in exactly one of these; everything else links to it. Older documents and history reference the pre-merge filenames; the mapping above resolves them.

---

## 0. HOW TO USE THIS

Sections 1–3 are settled decisions. Section 4 is the data model. Sections 5–7 are topology, sequencing, and the invariants. Section 8 (added 2026-08-04) holds the decisions made after the platform went live — including the open ones, marked **open**, which still need Jason. A D-entry without a status marker is settled. IDs are permanent: superseded entries stay, with a note pointing at what replaced them.

**The rule that governs everything: one codebase, N tenants, zero per-client code.** Any decision that quietly violates that rule is wrong even when it's convenient, even when it's faster, even when it's just this once.

### These documents are living

They are written to be **amended, not preserved.** The first four real clients will invalidate parts of all four — that is what real clients are for, and it is not a failure of planning. Expect to rewrite whole sections.

**When reality contradicts a document, change the document,** and leave a one-line note saying what changed and why. A spec that has quietly stopped describing the system is worse than no spec, because the next contributor — human or AI — will trust it.

The invariants in §7 are the exception. Those are load-bearing and do not drift.

---

## 1. THE PRODUCT

Curbside Sites sells a local service business a website plus a mandatory care plan, then a ladder of recurring services on top.

- **Entry product:** a fast, accessible, SEO-correct site for a local service business — trades, automotive, off-road, marine, home services.
- **The actual business:** the recurring plan. **The site is the invoice, not the product.**
- **The ladder:** care plan (mandatory) → local visibility / SEO → call tracking & analytics → booking, CRM, AI quote assistant.
- **Explicitly out of scope: managed IT / MSP work.** Microsoft 365 / Google Workspace setup is sold as a **one-time engagement with no ongoing support obligation**, and the MSA says so.

The stubbed features in the tenant app are the price list. They ship fully typed and demo-wired so a client can *see* a feature working before they buy it. That is the sales mechanism, and it is architectural.

---

## 2. THE FOUR PLANES

| Plane | What it is | Spec |
|---|---|---|
| **Tenant app** | The multi-tenant Next.js site that renders *any* client from a database record | `SPECS.md` Part I |
| **Control plane** | Onboarding intake, provisioning, secrets, billing, fleet health dashboard | `SPECS.md` Part II |
| **Growth plane** | Review aggregation, analytics, monthly report, content pipeline, local SEO ops | `SPECS.md` Part III |
| **Comms** | Client change requests. **v1 lives inside the tenant app's client portal** (see D9); it becomes its own plane when SMS ships. | — |

Planes communicate through the database and typed contracts. Never by reaching into each other's internals.

---

## 3. SETTLED DECISIONS

### D1 — Multi-tenant, config-driven, single codebase
One Next.js application (latest stable, App Router, TypeScript, `src/`). Tenant resolved at request time from the `Host` header. No per-client repos. No forks. Adding a client is a database row plus a hostname, not a deploy.

**Rationale:** a security patch must be one deploy, not 200 PRs. The entire business scales on this.

### D2 — Code in Git, content and config in the database
- **Git:** application code, components, the section registry, migrations, per-tenant custom sections (D17).
- **Postgres:** business identity (NAP, hours, socials), services, brand tokens, content and blog posts, image manifest, feature flags, integration state.

**The propagation guarantee:** the tenant record is the single source of truth. Header, footer, service pages, form dropdowns, sitemap, JSON-LD, `llms.txt`, privacy policy, OG images — **all** derive from it. Adding a service to a tenant's record propagates everywhere with zero other edits. **Hardcoding any of it in a component is forbidden.**

**Rationale:** the client portal, the change-request chat, and the onboarding form all need to write business data without triggering a code deploy. There is no config file. A config file is the one-client version of this idea and it cannot survive a shop owner editing their hours.

### D3 — Named services (be explicit; do not substitute)

| Concern | Service | Notes |
|---|---|---|
| Database | **Azure Database for PostgreSQL — Flexible Server**, Burstable tier (B1ms → B2s) | Postgres, not Cosmos. We need relational integrity and Row-Level Security. |
| Compute | **Azure Container Apps** | Same Azure region as the database. |
| Secrets | **Azure Key Vault** | Accessed via **Azure Managed Identity**. No connection strings in config. |
| Object storage | **Azure Blob Storage** | Client photos, static failover snapshots, generated report PDFs. |
| CDN / WAF / DNS | **Cloudflare** | |
| Customer domains + TLS | **Cloudflare for SaaS — Custom Hostnames** | Auto-provisions and renews a TLS cert per client domain. This is the specific product that solves "hundreds of customer-owned domains, one origin." |
| Billing | **Stripe Billing** | Curbside's own Stripe account. |
| Email (transactional) | **Resend** (picked — ASSUMPTIONS #1) | Per-domain SPF/DKIM/DMARC required (see §6). |
| Error tracking | **Sentry**, tagged by `tenant_id` — **not yet wired** (ASSUMPTIONS #77; interim alerting = edge Worker failover emails + Azure Monitor + in-app alarms). The row stands as the intended vendor. | |
| Reviews | **Google Places API (v1)** and **Yelp Fusion API** | Plain `fetch` against REST. No SDKs. |
| Analytics | **Plausible** (picked — ASSUMPTIONS #2; cookieless, which is load-bearing for D13) | Self-reported conversions still write to our own `events` table (D14). |
| AI | **Anthropic API** | Change-request parsing, content drafting, quote assistant. |
| SMS (deferred) | **Twilio** | Blocked on A2P 10DLC. See §6 and D9. |

**Do not substitute a service for a similar one without recording the swap in `ASSUMPTIONS.md`.** Where this table says "pick one," pick one and say which.

### D4 — Tenant isolation: one database, `tenant_id` everywhere, enforced by Row-Level Security
Single Postgres database, single schema. Every tenant-owned row carries `tenant_id`. **PostgreSQL RLS policies enforce isolation at the database layer** — not in application code, where one forgotten `WHERE` clause leaks a competitor's leads.

The app connects as a role that **cannot** bypass RLS. Tenant is set **per transaction** with `SET LOCAL app.tenant_id`.

**`SET LOCAL`, inside the transaction — never `SET`.** Under a connection pool, a session-level `SET` leaks the previous request's tenant onto the next request that reuses the connection. That bug does not throw, does not log, and serves one shop another shop's leads.

**This is the highest-severity risk in the platform.** One shop seeing another shop's leads is an extinction-level trust event in a market that runs on referrals. CI contains a test that attempts a cross-tenant read and asserts zero rows; if it is ever deleted or skipped, the build fails.

### D5 — Demo data lives in the same database
Demo rows are tenant-scoped with `is_demo = true`. A tenant renders demo rows until its first real record of that type exists, then real data takes over.

**Never mix demo and real records in one view.**

Demo content must be realistic and localized — the actual nearby lakes and trails, the vehicles this customer base drives, local area codes, plausible names and job details. Demo screenshots *are* the sales asset. Label demo feeds with one quiet line: "sample reviews — live feed activates with API keys."

### D6 — Static failover, with alerting
A job exports each tenant to static HTML in Blob Storage — nightly and after every deploy. Cloudflare health-checks the origin and serves the snapshot on failure. Hours, services, and tap-to-call keep working; forms degrade to `tel:` and `mailto:`.

**Health checks are semantic, not status-code.** A bad deploy returns 200 with the wrong phone number. Assert: rendered HTML contains this tenant's canonical phone number; the JSON-LD parses as valid JSON; the contact endpoint returns its expected shape.

**Every failover event alerts us immediately.** A silent failover lasting a week is a site we believe is live and isn't.

### D7 — Billing yes, payment processing no (v1)
- **Billing clients:** Stripe Billing on Curbside's account. One Customer per tenant. Subscription per tier. **Add-ons are subscription items that map 1:1 onto the tenant's feature flags** — buying an add-on flips a flag, with no separate provisioning step.
- **ACH is the default payment method**, card is the fallback, and ACH is pre-selected at signup. On a $749/mo plan, card fees cost roughly $270/yr per client that ACH does not.
- **Automated dunning from day one.** At 100 clients several cards fail every month; manual chasing is a collections job you accidentally hired yourself for.
- Setup deposit collected **before the build begins.** Demo mode lets us show a finished site before payment — leverage, and also exposure.
- **Processing payments *for* clients is deferred.** When it ships it ships as **Stripe Connect Standard**: the client owns their Stripe account and is the merchant of record, Curbside takes an application fee, and chargeback liability on a disputed $4,000 lift-kit deposit stays with them. **We never become the aggregator.**

### D8 — The client owns their credentials, always
We never take registrar credentials. We never take a Google Business Profile login. The intake form asks *which registrar they use* — the name, nothing more — and we send them registrar-specific **DNS record instructions** (a CNAME plus an ownership TXT — see D15). For GBP we request **manager** access.

*(Amended 2026-08-04: originally said "nameserver instructions." What shipped and was proven on the first go-live is record instructions — the client's DNS stays at their registrar, which is more D8 than a nameserver move ever was. See ASSUMPTIONS #40 and D22 for the apex-domain wrinkle.)*

**Rationale:** credential custody is liability with no upside, and in a referral-driven local market, being the guy who held a client's domain hostage ends the company.

### D9 — Change requests: AI proposes, the *client* confirms
**v1 channel: authenticated chat in the client portal** (inside the tenant app). Twilio SMS is deferred behind A2P 10DLC (§6).

The client says what they want ("make Saturday 8-2"). The AI parses it into a **typed config diff** against the tenant record. The diff is rendered back in plain language: *"Confirm: Saturday 8:00 AM–2:00 PM?"* On confirm, it writes, revalidates that tenant's cache, and logs the change with the original message as the audit record.

**The confirmation gate sits on the client, not on us.** They know the answer; we don't. It costs us zero time and produces a defensible audit trail for "I never said that."

**Never auto-apply an LLM-parsed change to a live business's hours without confirmation.** A shop closed on a day it advertised as open is a real cost to a real person.

**The channel is an adapter.** `ChangeRequestChannel` interface, `chat.ts` now, `sms.ts` later. Swapping to Twilio is a config flip, not a rewrite.

Anything the AI cannot map to a typed diff, or that the client marks urgent, escalates to the control plane queue.

### D10 — Third-party APIs: centralized, cached, staggered
**No tenant app request ever calls a vendor API.** Scheduled jobs fetch for all tenants, staggered across the window, and write to our tables; tenants read our rows.

Reviews refresh weekly-to-monthly, not daily. Live reviews are not time-critical, and the quota math at 200 tenants is unforgiving.

### D11 — Every integration behind a typed adapter; demo is also the failure mode

```
src/lib/adapters/<integration>/
  types.ts   // the interface the app codes against
  live.ts    // real implementation; reads tenant config + Key Vault
  demo.ts    // returns is_demo rows
  index.ts   // selects live or demo, per tenant, at runtime
```

- Missing config for **this tenant** → demo adapter, one warning. Complete → live.
- **No integration may be individually broken.** A missing Yelp key for tenant A must not affect tenant A's newsletter, and must not affect tenant B at all.
- **Demo is the failure mode, not just the unconfigured mode.** Wrap every live call in try/catch, fall back to demo on any API error (bad key, quota, outage), log one `console.error`, record `last_error_at` on the integration row. **A dead reviews API never breaks a page.**
- **Half-configured is worse than unconfigured.** If a gating flag is on but the implementation behind it isn't wired, **throw loudly**, naming the exact file and function to edit. Never silently serve demo while the operator believes a feature is live.
- Secrets resolve from Key Vault via managed identity, referenced by `kv_secret_ref` on the integration row. Never `.env` in production, never in the database, never client-side.

**The bar:** a brand-new tenant row with zero integrations configured must produce a **fully browsable, screenshot-ready site**. Then configuring each integration lights it up with **zero code changes**.

### D12 — Accessibility is a build gate
WCAG 2.2 AA, enforced by **automated axe testing in CI against every tenant's rendered pages, using that tenant's actual brand tokens.** Violations fail the build. Every tenant ships an accessibility statement.

Contrast must be checked **per tenant**: a palette that passes AA for one brand fails for another, and that is precisely the violation a template-level check misses.

**Rationale:** ADA website demand letters against small businesses are an active plaintiff industry in California, and Curbside's clients are California small businesses. If we ship an inaccessible site, we are the reason our client got sued. It is also a genuine selling point nobody else in this market is making.

### D13 — Privacy and legal are generated, not pasted
Per tenant, from the record: privacy policy, terms, cookie consent (CMP), CCPA/CPRA opt-out plumbing. Curbside is a data processor holding lead PII for hundreds of California businesses. Baked in from row one, not retrofitted.

### D14 — Instrument business outcomes, not web metrics
The `events` table records conversions: `call_tap`, `form_submit`, `map_tap`, `newsletter_signup`, `booking_started`, `booking_completed`, each with source attribution. Pageviews are a supporting metric that never appears in front of a client.

### D15 — Compute topology
**Azure Container Apps**, same region as the Postgres server. **Cloudflare for SaaS (Custom Hostnames)** in front, owning every customer domain and auto-provisioning TLS per domain — roughly a dime per hostname per month, and it solves the genuinely painful part of multi-tenant custom domains.

Onboarding a domain is an API call: create the Custom Hostname, hand the client registrar-specific **DNS record instructions** (CNAME to the fallback origin + ownership TXT — the domain stays at their registrar), poll until verified, flip the tenant live.

*(Amended 2026-08-04: "nameserver instructions" corrected to record instructions — that is how Cloudflare for SaaS actually works, and it's what shipped (ASSUMPTIONS #40). Field wrinkle from the first go-live: a CNAME can't exist at a zone apex, so on registrars without flattening (GoDaddy) the custom hostname is `www` plus a registrar apex-forward — see D22, which also owns the HTTPS requirement on that forward.)*

*Rejected:* Vercel. Excellent Next.js host, but it puts the app in a different cloud from its database and costs meaningfully more at 200 tenants.

### D16 — Auth
- **`owner`** (the client): **email magic link**, short session, **scoped to exactly one tenant.** Shop owners will not manage passwords, and every password we store is unpaid liability.
- **`staff`** (Curbside): real auth with MFA, full fleet access, control plane only.

Two different surfaces. Never conflate them. A staff session must never leak into a tenant-scoped context.

*Rejected:* Entra External ID / Azure AD B2C. Correct at enterprise scale, needless ceremony for 200 sole proprietors.

### D17 — Custom work: the only escape hatch
Core exposes a **section registry** of named, typed sections. A tenant's config declares which sections render, on which page, in what order, with what props.

Custom sections live at `clients/<slug>/sections/*` in the monorepo — versioned, reviewable, deployed with the fleet, invisible to every other tenant.

**The inviolable rule: an override may never require a change to core.** If a custom request would touch core, it stops being custom work and becomes a **feature flag in core available to every tenant.** That single rule is what keeps 200 sites upgradable.

Custom sections are a priced line item **plus** a care-plan bump, because Curbside now maintains something exactly one person uses.

### D18 — Content lives in the database
Blog posts and pages are DB rows: typed frontmatter columns plus an MDX body, validated with Zod on write.

**Rationale:** the SEO tier's core deliverable is monthly content. If publishing a post requires a commit and a deploy, the growth product is coupled to the release process — exactly backwards. Publishing must be a write plus an ISR revalidation, nothing more.

### D19 — Pricing model
Architecturally, **every tier and add-on is a feature flag on the tenant record.** Nothing about a plan is ever hardcoded. The numbers below are the v1 pricing and are expected to move in the field; the architecture does not care what they are.

**One-time**
- Setup: **$2,500** ($1,000 deposit before build begins)
- Custom section: **$500–1,500** each, plus **+$25/mo** to the care plan
- Microsoft 365 / Google Workspace setup: **$750–1,500**, one-time, no ongoing support (D1 of §1)

**Recurring — every client is on one of these. No exceptions.**

| Plan | Price | Includes |
|---|---|---|
| **Curb** (base care plan — mandatory) | **$199/mo** | Hosting, SSL, DNS, monitoring, static failover, backups, security and dependency updates, unlimited content edits via the portal chat, monthly report |
| **Curb+** (visibility) | **$749/mo** | Everything in Curb, plus Google Business Profile management, NAP/citation monitoring, review solicitation, 2 posts/mo, rank tracking, quarterly strategy call |
| **Curb Pro** (growth) | **$1,499/mo** | Everything in Curb+, plus call tracking with DNI, booking, CRM, AI quote assistant, 4 posts/mo |

**À la carte, monthly, on top of any plan**
- CRM **$49** · Booking **$79** · Online payments **$49** (when Connect ships) · AI quote assistant **$149** · Call tracking **$99** · Extra post **$250 each**

**The math, honestly.** A realistic mix (80% Curb, 15% Curb+, 5% Curb Pro) blends to roughly **$346/tenant/mo**, which reaches **$60k MRR at ~175 tenants** — not 200. The pricing works.

What the pricing does *not* solve is acquisition. Getting to 175 local SMB clients is a grind of cold outreach and long cycles with small checks, and at 10% annual churn it takes ~18 new logos a year just to stand still. **AI collapsed delivery; it did not collapse sales.** The hard part of this business was never the code.

### D20 — Offboarding
On departure: they keep the domain, always. The tenant serves a dignified "under construction" page, and they receive a full export of traffic, conversions, leads, reviews, and rankings.

**That exit report is the same artifact as the monthly report.** Build it once. As a monthly deliverable it is the strongest retention mechanism Curbside has; as an exit document it is the same numbers, ending.

Offboarding should be genuinely gracious. In a referral market, how you treat someone on the way out is a marketing channel.

---

## 4. DATA MODEL (sketch)

```
tenants          id, slug, business_name, status(draft|live|suspended), plan_tier
domains          tenant_id, hostname, is_primary, cf_hostname_id, verified_at
business_profile tenant_id, nap{name,address,phone_display,phone_tel},
                 hours, geo, socials, service_area, schema_subtype
services         tenant_id, slug, name, blurb, body, sort_order
brand            tenant_id, tokens{brand,brand_dark,surface,surface_raised,
                 ink,ink_muted,edge,accent}, font_pairing_key, logo_url
sections         tenant_id, page, section_name, sort_order, props
images           tenant_id, slot_id, purpose, alt, aspect, url, credit
content          tenant_id, type(post|page), slug, frontmatter, body, published_at
leads            tenant_id, name, contact, service, vehicle, message, source,
                 status(new|contacted|quoted|won|lost), notes[], is_demo
subscribers      tenant_id, email, is_demo
reviews          tenant_id, source(google|yelp), author, rating, body,
                 fetched_at, is_demo
integrations     tenant_id, key, mode(live|demo), kv_secret_ref,
                 key_owner(client|curbside), last_error_at
events           tenant_id, type, payload, created_at
billing          tenant_id, stripe_customer_id, subscription_id, mrr, status
change_requests  tenant_id, raw_message, parsed_diff, status, confirmed_at
```

**Every tenant-scoped table: RLS policy on `tenant_id`. No exceptions. CI proves it.**

---

## 5. ENVIRONMENTS

*(Amended 2026-08-04. The original section described staging and canary environments that were never provisioned — zero references to either exist outside this file. What follows is what actually exists, plus the deferred decision.)*

- **production** — one Container App, max-replicas 1 (RUNBOOK as-built). The availability story at this scale is the edge Worker + static failover snapshots (D6), which is deployed and current — not a second environment.
- **rollback** — **one action, reachable from a phone.** Exists and was verified from a phone (RUNBOOK 11.4). If a deploy breaks 200 businesses' phone lines at 6pm on a Friday, the recovery path cannot require a laptop.
- **staging / canary** — **deferred, not built** (see D25). Until they exist: every deploy must pass `npm run verify` locally first, CI must be green (D24), and any change that reshapes live tenants' pages (registry cuts, section changes) gets soaked on the two demo-fleet tenants before the fleet sees it. Re-decide at the first month with 10+ paying tenants — that's when "the demo tenants caught it" stops being enough.

---

## 6. CALENDAR TIME ≠ DEV TIME

AI compresses the code. It does not compress any of the following, and every one is a hard dependency on going live. **Start these in parallel with the build, not after it.**

- **Twilio A2P 10DLC.** Precisely: *receiving* inbound SMS is unregulated, but *sending* any SMS to a US recipient is A2P traffic requiring brand + campaign registration — carriers filter unregistered traffic and Twilio bills a penalty on it. Our design's safety gate is an **outbound** confirmation, so **the gate is the regulated part.** Brand approval is fast; **campaign review currently runs 10–15 days.** Registration requires a live website with a privacy policy, so curbsidesites.com is a dependency of the comms plane.
  - **Scope trap:** the client update line is *Curbside messaging its own clients* — one brand, one campaign, customer-care use case. But **missed-call text-back is a client's business messaging that client's customers**, which is per-client A2P and requires **ISV onboarding with a brand and campaign registered per client.** Materially bigger compliance surface. Not a weekend feature. Price and sequence accordingly.
- **Google Business Profile verification** — postcard or video, days to weeks, per client.
- **Email deliverability** — SPF/DKIM/DMARC **per client domain**, plus sending-domain warming. A lead notification silently landing in spam is worse than no form at all: the owner concludes the site produces nothing and churns without ever telling you why. Verify deliverability at onboarding *and* continuously (`SPECS.md` §II Part 5) — resolved at the registrable domain, never the `www` host (D22).
- **DNS propagation** and client responsiveness on DNS record changes. Clients are slow. Chase automatically.
- **Stripe account review**, MSA drafting, E&O insurance, California LLC formation.

The build may well be a focused Sunday. **Going live is not.**

---

## 7. INVARIANTS (these do not drift)

1. **No per-client code in core.** Ever. The first hand-edit is the first re-fork.
2. **RLS on every tenant-scoped table**, proven by a test that tries to break it. `SET LOCAL`, never `SET`.
3. **No secrets client-side. No secrets in Git. No secrets in the database.** Key Vault or it doesn't exist. No endpoint, log, dashboard, or error message ever returns a secret *value* — only names and whether they're populated.
4. **Every integration goes behind an adapter with a demo implementation.** Demo is the failure mode.
5. **Demo and real data never appear in the same view.**
6. **NAP is byte-identical everywhere** — header, footer, contact, schema, `llms.txt`, GBP, citations — which is automatic because it has exactly one home. Call-tracking numbers use **dynamic number insertion in the rendered page only**; the canonical NAP number never changes anywhere else. Get this wrong and the SEO product sabotages the SEO product.
7. **`aggregateRating` JSON-LD is emitted ONLY when live review rows exist.** Never from `is_demo` rows. Fake structured data is a penalty, not a boost — applied to a real person's livelihood.
8. **Accessibility gate in CI. It fails the build.** *Status note (updated 2026-08-06, Session 1): the red-CI cause was found and fixed — the control-plane e2e specs assert against fleet fixtures CI never seeded (`db:seed:fleet` is now a workflow step); the full suite is green when the workflow is replayed from an empty database. **The claim stays suspended** until a GitHub-hosted run proves it: Actions was in a major outage through that session and produced no run. Branch protection follows the first green run (D24). Second gap unchanged: the axe suite runs against the two seeded demo tenants only, not "every tenant's rendered pages" as D12 claims — no real client's approved tokens have been through it.*
9. **Semantic health checks, not status-code health checks.** *Scope note (2026-08-04): the existing checks prove self-consistency with the DB (the page shows the phone number the record holds) — they cannot catch a wrong record. What may go `live` is D26's question.*
10. **Sitemap, robots, `llms.txt`, JSON-LD, privacy policy: all generated. Never hand-maintained.** *Status note (2026-08-04): currently violated in production by Cloudflare's Managed robots.txt, which prepends AI-crawler blocks (GPTBot, ClaudeBot, CCBot…) to every tenant's generated robots.txt — directly against the llms.txt discovery strategy. Open decision D27.*
11. **The Curbside backlink in each tenant footer varies its anchor text per tenant** and points somewhere genuinely useful. Two hundred identical footer links with identical anchors is a textbook link-scheme footprint — a single point of failure that would penalize 200 client sites simultaneously. *Status note (resolved-interim 2026-08-06, Session 1): three of five targets were 404ing (measured against production); all five now resolve to the marketing root with distinct anchor text and distinct hrefs, and `npm run test:credits` fails the build if any target stops returning 200. The real fix — actual marketing pages — is Session 2, which swaps the paths back under the same test.*
12. **Never inflate a client-facing number.** Not in the monthly report, not in a demo, not in a pitch.

---

## 8. DECISIONS MADE AFTER GO-LIVE (2026-08-04 review)

Recorded during the architecture re-validation session, from an adversarial review of the record against the deployed system. Statuses per entry; **open** entries still need Jason and nothing may build on a guessed answer to them.

### D21 — dubdating.com is a test fixture, not a client
- **Status:** settled (Jason, 2026-08-04). **The noindex mechanism shipped 2026-08-06 (Session 1)** as a `features.noindex` flag in core (D17 shape, not a special case), forcing the robots meta and robots.txt; **the production flip is a [YOU] step** (RUNBOOK 11.5 step 6). Note: the meta tag is what deindexes — Cloudflare's Managed robots.txt (D27) overrides the robots.txt half, and that is deliberate, since the crawler must be allowed to fetch the page to see the meta.
- **Decision:** The dub-dates tenant is a simulation that validated the go-live pipeline. It gets `noindex` (it is currently live and indexable with placeholder NAP — `(123) 123-1231`, "LA Street" — in public structured data). §1's ICP (trades, automotive, off-road, marine, home services) stands unchanged; dub-dates being a multi-city dating service does not widen it.
- **Rejected alternatives:**
  - Treat it as a real client — no MSA, no billing, and the record data is fabricated; calling it a client would make the fake NAP a live client-quality incident.
  - Leave it indexable — fake structured data under a real domain violates the spirit of Invariant 12 and trains Google on junk.

### D22 — Domain attachment: DNS records, with the apex handled deliberately
- **Status:** settled
- **Decision:** Clients attach domains via a CNAME (to the fallback origin) plus an ownership TXT; their DNS stays at their registrar (D8). Where the desired hostname is a zone **apex** on a registrar without CNAME flattening (GoDaddy), the custom hostname is `www` and the registrar apex-forward points at it — and that forward **must land on HTTPS** (the current one hops through plain HTTP). Instruction generation must branch on apex-vs-subdomain and registrar flattening support. Email-deliverability checks (SPF/DKIM/DMARC) resolve at the **registrable domain**, never the site hostname — checking `_dmarc.www.<domain>` is structurally always empty and would page on every future client.
- **Rejected alternatives:**
  - Nameserver delegation to Cloudflare — flattens the apex, but moves the client's DNS out of their registrar, which contradicts D8's "they keep the domain" promise as clients understand it.
- **Invariants:**
  - "A client's canonical entry point never traverses plain HTTP." — **catastrophe if violated:** the flagship "they keep their domain" promise ships with a cleartext hop on every visit to the apex.

### D23 — The origin/edge boundary is load-bearing: lock ACA ingress to the edge
- **Status:** settled (Jason, 2026-08-04 — origin lock only; repo visibility deliberately left public, revisit if the leak repro remains published after the leak is fixed). **Implemented 2026-08-06 (Session 1), NOT YET DEPLOYED** — mechanism is a shared-secret header (`X-Curbside-Edge`) set by the Worker and validated in `src/proxy.ts`, chosen over Cloudflare-IP ingress restrictions because an IP allowlist authenticates Cloudflare's network rather than our Worker (ASSUMPTIONS #91). Cutover procedure and acceptance: RUNBOOK 11.5. The attack was re-confirmed live on 2026-08-06 (forged header → 200) and closes when that deploy lands.
- **Decision:** The Container App origin must reject traffic that did not come through our Cloudflare Worker (shared-secret header validated in `src/proxy.ts`, or CF IP restriction on ingress). Today the origin FQDN is public (it's in `wrangler.toml`, in a public repo) and honors attacker-supplied `X-Forwarded-Host` — every edge control (WAF, rate limits, redirects, failover) is optional to anyone who addresses the origin directly.
- **Invariants:**
  - "`TRUST_PROXY_HOST=1` is only ever set behind an ingress that authenticates the edge." — **catastrophe if violated:** anyone impersonates any tenant's hostname with one curl header, and the draft-content leak's published repro works against the bare origin.

### D24 — CI goes green before anything else builds, then `main` gets protected
- **Status:** settled (Jason, 2026-08-04)
- **Decision:** CI has failed on every run in the repo's history while eight sessions and a go-live shipped over it. The next build session's exit criterion is one green run on `main` (fix the failing e2e step, named from the run log), followed by branch protection requiring `verify`. Until then, §7 #8's enforcement claim is suspended (see its status note) — the record does not cite a red gate as proof.
- **Rejected alternatives:**
  - Amend the claim and defer the fix — leaves the axe and lifecycle suites decorative while live-tenant-affecting sessions (registry cuts) are queued.

### D25 — Staging and canary: deferred, on a named trigger
- **Status:** deferred
- **Decision:** §5 originally described staging + canary environments that were never provisioned. Deferred deliberately (they roughly double the infra bill at a stage with one fixture tenant), **not** abandoned: re-decide at the first month with 10+ paying tenants, or before the first registry-cutting session that reshapes live pages — whichever comes first. Until then the §5 interim rules apply (local `verify`, green CI, demo-fleet soak).

### D26 — What a tenant must prove before `status='live'` (the data-quality gate)
- **Status:** open — needs Jason to settle the gate's exact contents
- **Question:** `maybeGoLive` checks brand approval + domain verification, but nothing checks the *record* describes a real business. The fixture went live with placeholder NAP in public JSON-LD and 0 of 10 image slots populated, and every §7 check passed — the checks prove self-consistency, not correctness. Proposed gate: phone parses and isn't a placeholder pattern, address geocodes, every image slot has `url` + `credit`, and the operator confirms NAP against a source outside our own database.

### D27 — Cloudflare Managed robots.txt vs. the llms.txt strategy
- **Status:** open — needs Jason (one dashboard toggle, but it's a product decision)
- **New measurement (2026-08-06, Session 1):** the managed block wins in practice. It prepends `User-agent: * / Allow: /` ahead of our generated body, and for equal-length rules the least restrictive wins — so a tenant we mark `Disallow: /` still serves as crawlable. Deindexing therefore rests entirely on the robots **meta** tag (which is why D21's fixture flip works). Any resolution of D27 that blocks crawling must account for this: a crawler that can't fetch the page can't see a `noindex` meta, and the page stays in the index.
- **Question:** Cloudflare's Managed robots.txt currently prepends AI-crawler blocks (GPTBot, ClaudeBot, CCBot, `Content-Signal: ai-train=no`) to every tenant's robots.txt. The product ships `llms.txt` on every tenant specifically to court AI-assistant discovery ("who does boat service near me"). These are opposite bets. Either disable the managed feature (robots.txt returns to fully generated, Invariant 10 restored) or keep it and rewrite the llms.txt story. Note the distinction available: `ai-train=no` vs. blocking AI *search/assistant* crawlers — Cloudflare's signal can express "don't train, do answer."

### D28 — Single-operator continuity
- **Status:** open — needs Jason
- **Question:** Production access is one person: credentials in `~/.curbside-env-01` on one laptop (plus a stale, world-readable copy **inside the working tree** — delete it), rollback verified from one phone, one staff account bootstrapped, failover alerts to one personal Gmail. Nothing in the record says what happens if that person is unavailable for a week. Minimum viable answer: a sealed break-glass credential set, a second alert recipient, and a one-page "if Jason is unreachable" note. Decide the shape; the hardening session implements it.
