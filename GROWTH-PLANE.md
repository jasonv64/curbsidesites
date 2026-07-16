# GROWTH-PLANE.md — Build Spec

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

- **Voice reference:** the onboarding call transcript (`CONTROL-PLANE.md` §2.4), **usable only where consent is recorded on the tenant** (§2.2). No consent → fall back to the intake form's free-text voice field. The pipeline must check this and refuse, not assume.
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
