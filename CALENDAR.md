# CALENDAR.md — calendar time ≠ dev time

Everything from `ARCHITECTURE.md` §6 (plus what Session 4 surfaced) that
takes **real-world waiting** rather than work. The build is a weekend; these
are why going live is not. Durations are realistic, not best-case.

## Start on day one — before or alongside RUNBOOK Phase 1

These have long fuses, no dependencies you don't already have, and every
one of them is on the critical path to *charging a real client*:

| # | Item | Realistic duration | Why it can't wait |
|---|---|---|---|
| 1 | **Stripe account + business verification** | 1–7 days; payouts sometimes held longer for new accounts | Phase 9 needs a verified account; the first deposit needs payouts working. Start with whatever entity you have — see #6. |
| 2 | **Twilio A2P 10DLC brand + campaign registration** | Brand: ~1 day. **Campaign review: 10–15 business days**, longer on rejection-and-resubmit | The SMS confirmation gate (D9) is *outbound* — the regulated part. Registration needs a live website with a privacy policy: the platform's tenant privacy pages exist, but the **company site is Session 5**, so realistically this files right after Session 5's curbsidesites.com is up. Put it at the top of that session's exit checklist. ⚠️ Scope trap (ARCHITECTURE §6): this covers *Curbside texting its clients* — one brand, one campaign. Missed-call text-back for clients is per-client ISV registration: a different, much bigger project. Price and sequence it as one. |
| 3 | **Domain purchase + nameserver move** | Minutes to 24 h (rarely 48 h) | Phase 6 blocks on it; every DNS-dependent item below chains behind it. |
| 4 | **Email domain warming** | 2–4 weeks of low, human-looking volume before you can trust bulk deliverability | A brand-new domain's first 50 emails decide its reputation. From the day DNS lands (Phase 8): send real one-to-one mail from `hello@curbsidesites.com`, keep DMARC at `p=none` while watching reports, move to `quarantine` after 2 clean weeks. The monthly-report blast on the 2nd must not be the domain's first impression. |
| 5 | **MSA + consent-language lawyer review** | 1–2 weeks for a small-business attorney's turnaround | The recording-consent copy (CONTROL-PLANE 2.2) and the suspension/offboarding terms (D20) must be reviewed **before the first real onboarding call is recorded** — Penal Code §632 is criminal, not civil. Cheapest insurance in the business. |
| 6 | **California LLC + E&O insurance** | LLC: days (online) to ~3 weeks (standard processing); E&O: ~1 week of quotes | Stripe verification (#1), the MSA (#5), and the bank account all want the entity to exist first. This is the true first domino — file it *today*. |

## Per-client waits — the recurring calendar

These reset with **every** client. The pipeline automates the chasing
(CONTROL-PLANE 2.5); the calendar is still the calendar. Set the client's
expectation at the 30-minute call: *"site's done in days; live on your
domain in one to three weeks, mostly waiting on things only you can click."*

| Item | Realistic duration | Notes |
|---|---|---|
| Client adds the CNAME + TXT records | **1 day to 2 weeks** — dominated by client responsiveness, not DNS | The single slowest step in the whole funnel. The auto-chase emails every 3 quiet days; a phone call at day 7 beats email #3. |
| DNS propagation once they act | minutes–24 h | |
| Custom-hostname TLS cert issuance | minutes–1 h after DNS validates | Automatic (Cloudflare for SaaS). |
| Per-client sending domain (DKIM records → Resend verify) | rides the same DNS errand as the CNAME | Bundle the records in ONE email — clients do one registrar visit, not two. |
| **Google Business Profile verification** | days–weeks (postcard: 5–14 days; video: sometimes same-day) | Needed for GBP manager access (D8) and the Curb+ visibility work. Ask for manager access at the 30-min call; start verification the same day if they've never claimed it. |
| GBP re-instatement (suspended profiles — common after address edits) | 1–4 weeks, appeal-driven | Don't edit NAP on a fragile profile in week one. |
| Client's first ACH payment clears | 3–5 business days (vs instant cards) | The deposit gate ("paid before build") means: collect deposit at signing, run the build during the clearing window. |

## One-time platform waits already inside the runbook

Small, but they order the weekend:

| Item | Duration | Runbook phase |
|---|---|---|
| Azure RBAC role-assignment propagation | up to ~10 min each | 3.1, 4.1, 5.3 — the reason those phases say "wait, don't debug" |
| Postgres Flexible Server provisioning | 5–10 min | 2.1 |
| First ACR image build (chromium layer) | ~10 min | 5.1 |
| Cloudflare ACM certificate issuance | minutes, occasionally hours | 6.3 — order it, then go do Phase 7's export while it validates |
| Resend domain verification | minutes–hours | 8.1 |
| Stripe webhook "first event" confidence | immediate in test mode | 9.4 |

## The interleaved plan (what to actually do)

- **Today:** file the LLC (#6), open the Stripe account (#1), buy the domain
  (#3), email two attorneys for MSA/consent quotes (#5).
- **The build weekend:** RUNBOOK Phases 1–11 in order. Email warming (#4)
  starts the moment Phase 8's DNS lands — from then on it runs itself if you
  send a little real mail.
- **The week after:** Session 5 (curbsidesites.com + billing UI) → then
  immediately file Twilio brand + campaign (#2), because its 10–15 day
  review is the longest fuse left and it needs that site to exist.
- **First real client:** everything in "per-client waits" starts at the
  30-minute call — collect the GBP access request, the registrar name, and
  the deposit in that same call, or each becomes its own week of latency.

The theme, one more time: **AI collapsed delivery; it did not collapse
carrier reviews, DNS, banks, lawyers, or clients finding their registrar
password.** Start the fuses first; build while they burn.
