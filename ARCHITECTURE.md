# ARCHITECTURE.md

**Curbside Sites — multi-tenant website platform for local service businesses.**
Status: decision record. Owner: Jason.

This is the **single source of truth for decisions**. `TENANT-APP.md`, `CONTROL-PLANE.md`, and `GROWTH-PLANE.md` are build specs that reference decisions here by ID (D1, D2, …) rather than restating them. If a build spec contradicts this file, this file wins — or this file gets amended first, deliberately.

There are four documents and no others. Anything not in this set does not exist.

---

## 0. HOW TO USE THIS

Sections 1–3 are settled decisions. Section 4 is the data model. Sections 5–7 are topology, sequencing, and the invariants.

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
| **Tenant app** | The multi-tenant Next.js site that renders *any* client from a database record | `TENANT-APP.md` |
| **Control plane** | Onboarding intake, provisioning, secrets, billing, fleet health dashboard | `CONTROL-PLANE.md` |
| **Growth plane** | Review aggregation, analytics, monthly report, content pipeline, local SEO ops | `GROWTH-PLANE.md` |
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
| Email (transactional) | **Azure Communication Services Email** or **Resend** — pick one, name it in `ASSUMPTIONS.md`, do not use both | Per-domain SPF/DKIM/DMARC required (see §6). |
| Error tracking | **Sentry**, tagged by `tenant_id` | |
| Reviews | **Google Places API (v1)** and **Yelp Fusion API** | Plain `fetch` against REST. No SDKs. |
| Analytics | **Plausible** or **PostHog** — pick one, name it in `ASSUMPTIONS.md` | Self-reported conversions still write to our own `events` table (D14). |
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
We never take registrar credentials. We never take a Google Business Profile login. The intake form asks *which registrar they use* — the name, nothing more — and we send them registrar-specific nameserver instructions. For GBP we request **manager** access.

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

Onboarding a domain is an API call: create the Custom Hostname, hand the client registrar-specific nameserver instructions, poll until verified, flip the tenant live.

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

- **staging** — full clone, seeded with demo tenants. Every deploy lands here and passes the semantic smoke suite first.
- **canary** — 2–3 real tenants get prod deploys first, 30-minute soak, automated verification, then the fleet promotes.
- **rollback** — **one action, reachable from a phone.** If a deploy breaks 200 businesses' phone lines at 6pm on a Friday, the recovery path cannot require a laptop.

---

## 6. CALENDAR TIME ≠ DEV TIME

AI compresses the code. It does not compress any of the following, and every one is a hard dependency on going live. **Start these in parallel with the build, not after it.**

- **Twilio A2P 10DLC.** Precisely: *receiving* inbound SMS is unregulated, but *sending* any SMS to a US recipient is A2P traffic requiring brand + campaign registration — carriers filter unregistered traffic and Twilio bills a penalty on it. Our design's safety gate is an **outbound** confirmation, so **the gate is the regulated part.** Brand approval is fast; **campaign review currently runs 10–15 days.** Registration requires a live website with a privacy policy, so curbsidesites.com is a dependency of the comms plane.
  - **Scope trap:** the client update line is *Curbside messaging its own clients* — one brand, one campaign, customer-care use case. But **missed-call text-back is a client's business messaging that client's customers**, which is per-client A2P and requires **ISV onboarding with a brand and campaign registered per client.** Materially bigger compliance surface. Not a weekend feature. Price and sequence accordingly.
- **Google Business Profile verification** — postcard or video, days to weeks, per client.
- **Email deliverability** — SPF/DKIM/DMARC **per client domain**, plus sending-domain warming. A lead notification silently landing in spam is worse than no form at all: the owner concludes the site produces nothing and churns without ever telling you why. Verify deliverability at onboarding *and* continuously (`CONTROL-PLANE.md` §5).
- **DNS propagation** and client responsiveness on nameserver changes. Clients are slow. Chase automatically.
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
8. **Accessibility gate in CI. It fails the build.**
9. **Semantic health checks, not status-code health checks.**
10. **Sitemap, robots, `llms.txt`, JSON-LD, privacy policy: all generated. Never hand-maintained.**
11. **The Curbside backlink in each tenant footer varies its anchor text per tenant** and points somewhere genuinely useful. Two hundred identical footer links with identical anchors is a textbook link-scheme footprint — a single point of failure that would penalize 200 client sites simultaneously.
12. **Never inflate a client-facing number.** Not in the monthly report, not in a demo, not in a pitch.
