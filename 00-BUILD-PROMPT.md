# 00-BUILD-PROMPT.md — THE PLATFORM

**How to run this.** Paste each session below into Fable 5 with all four spec documents attached (`ARCHITECTURE.md`, `TENANT-APP.md`, `CONTROL-PLANE.md`, `GROWTH-PLANE.md`). Run the sessions **in order, as separate sessions** — not one. A single prompt asking for the whole platform produces a shallow version of everything and an excellent version of nothing.

The specs are the contract. This file is only the kickoff.

**Sessions 1–5 are the platform** — the thing that has to exist to have a business. When Session 5 is done, Curbside can sell a static site plus a care plan and get paid for it. Everything after Session 5 is enhancement work and lives in `01-BUILD-PROMPT.md`.

---

## SESSION 1 — THE TENANT APP

> You are building the Curbside Sites platform. Four specification documents are attached: `ARCHITECTURE.md`, `TENANT-APP.md`, `CONTROL-PLANE.md`, `GROWTH-PLANE.md`.
>
> **Read all four before writing a single line of code.** `ARCHITECTURE.md` is the contract — it holds every decision (D1–D20) and every invariant (§7). The other three are build specs that reference it. Where anything conflicts, `ARCHITECTURE.md` wins.
>
> **This session builds the tenant app only** (`TENANT-APP.md`). Do not build the control plane or the growth plane. Do not stub them in. Build one thing completely.
>
> **Run it locally first.** Postgres in Docker, seeded, no Azure. The entire app — two demo tenants, both browsable, RLS enforced, forms working, demo adapters serving — must run on `localhost` before any cloud service is touched. Cloud comes in Session 4, and it comes from a runbook, not from you.
>
> **Do not stop to ask clarifying questions.** Make the call, log it in `ASSUMPTIONS.md`, keep building. Where `ARCHITECTURE.md` D3 says "pick one," pick one and say which.
>
> **The acceptance test is D11:** a brand-new tenant row with zero integrations configured must produce a fully browsable, screenshot-ready site. Then configuring one integration must light it up with zero code changes.
>
> **The thing that must not be gotten wrong is D4** — row-level tenant isolation, `SET LOCAL` not `SET`, proven by a CI test that tries to break it two ways and gets zero rows both times. If application code is the only thing preventing a cross-tenant leak, you are not done.
>
> Work through `TENANT-APP.md` Part 15 (Verify Before Handoff) as an actual checklist, running each check against a live production server. **Report the results honestly. Do not describe a check you did not run.**
>
> Deliver everything in `TENANT-APP.md` Part 13, including a `README.md` written for the next contributor — human or AI — who will continue from that one file with no other context. Include API specs and where to access configs, not just how to set them.

---

## SESSION 2 — THE CONTROL PLANE

> Continue the Curbside Sites build. The tenant app is complete; its `README.md` and `ASSUMPTIONS.md` are attached along with the four specs.
>
> **This session builds the control plane** (`CONTROL-PLANE.md`) against the existing database and codebase. Do not restructure the tenant app; extend it.
>
> The onboarding pipeline (Part 2) is the point of this session. **The intake form's output is database rows, not a document** — a form submission must produce a `draft` tenant that is immediately browsable on its platform subdomain, with zero human database access anywhere in the path. That is Verify step 2, and it is the one that matters.
>
> Part 2.2 (recording consent) is a legal requirement, not a UX preference. Build it exactly as written, including the pipeline's refusal to run against an unconsented transcript.
>
> Same rules: don't stop to ask, log assumptions, run the Part 12 checklist for real, report honestly.

---

## SESSION 3 — THE GROWTH PLANE

> Continue the Curbside Sites build. Tenant app and control plane are complete; their READMEs and `ASSUMPTIONS.md` files are attached along with the four specs.
>
> **This session builds the growth plane** (`GROWTH-PLANE.md`).
>
> **Build the monthly report first** (Part 5), then build the instrumentation it needs. It is the product; everything else is feeding it. When it renders, read it as if you were a shop owner and ask whether the first number answers *"did this make me money?"* If it doesn't, the report is wrong regardless of whether it compiles.
>
> Same rules throughout.

---

## SESSION 4 — THE RUNBOOK

> All three planes are built and verified locally. Now write `RUNBOOK.md` — **the complete, ordered, executable instruction set for taking this from a local Docker Postgres to Curbside Sites' first three live demo tenants on real infrastructure.**
>
> Write it for one person doing this alone, at a laptop, over a weekend, who has never provisioned any of these services before. Assume competence, assume no familiarity.
>
> **Structure it in dependency order, as phases, where each phase ends in a verifiable state** — a thing I can check, not a thing I hope worked. Every phase begins with what must already be true and ends with "you should now be able to ___."
>
> **Split every step into one of two buckets, and mark them clearly:**
>
> - **[YOU]** — things only a human can do: create the Azure subscription, buy curbsidesites.com, open the Stripe account, register the Twilio brand, approve a brand palette, click a verification link, look at a photo.
> - **[RUN]** — things that are a command or a script. Give the **exact command**, not a description of the command. If a value must be substituted, name it and say where it comes from.
>
> **Cover, in the right order:**
>
> 1. Azure subscription, resource group, region choice (and *why* that region — the DB and Container Apps must be co-located)
> 2. Azure Database for PostgreSQL Flexible Server: provision, network rules, connection, migrations, RLS verification against the real database — **not just locally**
> 3. Azure Key Vault: create, managed identity, access policy, seed the first secrets, prove the app can read one and that no endpoint returns a value
> 4. Azure Blob Storage: containers, CORS, `next/image` remote patterns
> 5. Azure Container Apps: build, registry, deploy, environment config, health probes
> 6. Cloudflare: zone for curbsidesites.com, then **Cloudflare for SaaS Custom Hostnames** — the full flow for attaching one client-owned domain end to end, including exactly what to send the client and what to expect back.
>    **Cloudflare for SaaS must be explicitly enabled before any of this works, and enabling it is a [YOU] step.** It is bundled with the Free plan (100 custom hostnames included, $0.10/month each beyond that, no base fee), but it is *off* until someone clicks Enable at SSL/TLS → Custom Hostnames and puts a card on file — payment information is required on non-Enterprise zones even when the bill is $0. Until then every custom-hostname API call, **including read-only ones**, fails with `1404: No quota has been allocated for this zone or for this account` — an error whose text points at Enterprise sales and reads like a paywall, so say plainly in the runbook that it is not one. Two consequences the phase must state: the app's `customHostnames()` adapter will select the *live* provider and fail on every call the moment `CLOUDFLARE_ZONE_ID` is set with the token secret populated (D11 half-configured guard), and the Worker's zone-wide `*/*` catch-all route is **rejected** until Cloudflare for SaaS is on — explicit `curbsidesites.com/*` + `*.curbsidesites.com/*` patterns work in the meantime but do **not** match client-owned domains, so restoring the catch-all is part of this phase, not an afterthought.
> 7. Static failover: the export job, the Cloudflare health check, and **a deliberate origin kill to prove the snapshot actually serves**
> 8. Email: sending domain, SPF/DKIM/DMARC per client domain, and a delivered test — *delivered*, not sent
> 9. Stripe: products for Curb / Curb+ / Curb Pro per D19, ACH as default, dunning, webhook endpoint, test subscription
> 10. Seeding the first three demo tenants end to end through the real onboarding form
> 11. Monitoring, alerting, and the rollback path — **verify rollback from a phone before you need it**
>
> **Also give me a** `COSTS.md`**:** the actual monthly cost of this infrastructure at 3 tenants, at 50, and at 200, itemized per service, with the specific tier or SKU named at each scale and the first thing that breaks when I outgrow it.
>
> **And a** `CALENDAR.md`**:** everything in `ARCHITECTURE.md` §6 that takes real-world waiting rather than dev time — Twilio 10DLC campaign review, GBP verification, DNS propagation, Stripe review, domain warming — with realistic durations and **what I should start on day one so it isn't blocking me on day thirty.**
>
> Where a step could plausibly be done two ways, pick one and say why. Where a step can silently half-succeed, say what that looks like and how to tell. **Where I could destroy something irreversible, say so before the step, not after.**


---

## SESSION 5 — CURBSIDE SITES (OUR SITE) + BILLING

> **This is the session that makes Curbside sellable.** It has two halves: the company's own marketing site, and the billing engine that lets us charge clients. When this session is done, we can sell a static site plus a care plan and get paid for it — which is the whole business at its floor. Everything after this is upsell.
>
> Continue after Sessions 1–4. Do not block the platform build on it, but do not ship "live" without it — a platform you can't bill is a hobby.
>
> ### Half 1 — curbsidesites.com (the marketing site)
>
> A first-class site for Curbside Sites itself — brand, positioning, pricing narrative, how it works, a proof/demo path into real platform subdomains, and a clear CTA into onboarding (the control-plane intake already belongs here; this is the surrounding marketing surface and brand home).
>
> **Not another multi-tenant client.** Do not model Curbside as a `tenants` row unless you deliberately decide to and log it in `ASSUMPTIONS.md`. Prefer a dedicated marketing surface on curbsidesites.com that links into the platform, rather than bending D1 around ourselves.
>
> ### Half 2 — billing (D7)
>
> Build the client-billing engine. This is **billing clients**, not processing payments on client sites — Stripe **Connect** and client-side payments stay deferred (D7, and Session E of `01-BUILD-PROMPT.md`).
>
> - Stripe Billing on Curbside's own account. One Customer per tenant. Subscriptions.
> - **ACH default, card fallback**, ACH pre-selected at signup (D7).
> - **Automated dunning from day one** — retries plus emails; no manual chasing.
> - **One-time setup deposit collected via Checkout before a build begins** — demo mode lets us show a finished site before payment; that's the leverage and the exposure both.
> - Webhooks sync subscription status → `billing` and `tenants.plan_tier`.
> - Every plan and add-on is a **feature flag on the tenant record** (D19). Buying flips exactly one flag; no separate provisioning step.
> - The suspension path has a **human gate** (`CONTROL-PLANE.md` §4): failed payment → retries → warnings → a person confirms suspension. Never a webhook silently killing a live business's phone line over a $2 decline.
>
> ### The live reveal — the intake-to-demo moment
>
> This is the payoff of the entire demo-mode architecture, performed in front of the customer. When a visitor completes intake on curbsidesites.com **on their own**, they see a real-time progress indicator and are then handed a **live URL to their own demo site**, openable in a new tab, right then.
>
> - The progress indicator **tracks the real pipeline, not a fake timer.** It advances on actual events: intake rows written → brand tokens derived from their logo → placeholder images generated → sections composed → platform subdomain serving. If the bar is theater and the site 404s when it hits 100%, the best moment in the funnel becomes the worst. Never fake it.
> - The URL is the **platform subdomain** (`<slug>.sites.curbsidesites.com`), `draft` + `noindex`, which works the instant the tenant row exists (`TENANT-APP.md` Part 2). This is exactly why demo mode requires no API keys — nothing in the reveal is waiting on integration config.
> - The revealed URL only appears **after the subdomain actually serves a 200**, verified, not assumed. Poll the real thing; reveal on success.
> - Failure is handled honestly: if the pipeline stalls, the visitor sees a "we're finishing your preview, we'll email the link" path that captures their email and hands off to the control-plane queue — never a spinner that hangs forever.
> - This is a genuine tenant in `draft`, so everything downstream (brand gate, the 30-min call, domain, go-live) picks up seamlessly from the record the reveal just created. The reveal is the top of the onboarding funnel, not a throwaway.
>
> ### Pricing on the page — only what's honestly sellable today
>
> - **Setup deposit + Curb ($199/mo care plan)** are fully real now. Sell them.
> - **Curb+ and Curb Pro** contain services not yet live (SEO ops, call tracking, etc.). Show them as "available on request" or hide them — never list a feature on the pricing page that isn't live or honestly labeled. Session F of `01-BUILD-PROMPT.md` reconciles the full ladder once those services ship.
>
> ### Acceptance
>
> Someone who has never heard of Curbside can land on curbsidesites.com, understand what we sell, complete intake, **watch a real progress indicator, open a live demo of their own site in a new tab**, pay the setup deposit, and be put on a recurring care-plan subscription — without a client domain or staff credentials. The progress indicator reflects real pipeline state and the URL only reveals after the subdomain serves a verified 200. A test subscription flips the right flag on the tenant record. No pricing-page line names a feature that isn't live.
>
> Same rules: make the call, log assumptions, ship something complete enough to hand off.

---

## SESSION 6+ — ENHANCEMENTS

> Everything after Session 5 is enhancement work, not platform work — hardening, scope cuts, industry presets (kick-ass trade-specific templates), the design-as-config editor, activating stubbed services (payments, booking, call tracking, and the rest), and reconciling the full pricing ladder. It lives in `01-BUILD-PROMPT.md` and is pulled in only when there's a reason to: a client asking for a service, or breathing room to polish.
>
> The platform (Sessions 1–5) does not depend on any of it. When Session 5 is done, you can sell.
