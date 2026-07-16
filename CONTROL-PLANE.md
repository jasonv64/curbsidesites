# CONTROL-PLANE.md — Build Spec

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

Curbside records the onboarding call, transcribes it, stores the transcript, and uses it as an AI voice reference for content generation for the life of the account (2.4, and `GROWTH-PLANE.md` Part 5). That requires explicit, specific, documented consent.

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
- A **font pairing key** from the curated set (`TENANT-APP.md` Part 6 — fonts are build-time; you pick a key, not a font).
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

AI drafts site copy and 2–3 blog posts in the owner's voice, each targeting one long-tail local query. **Human review before publish, always** — see `GROWTH-PLANE.md` Part 6 for why that gate is not negotiable.

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
2. Generate the **exit report** — the same artifact as the monthly report (`GROWTH-PLANE.md` Part 5). Build it once.
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
