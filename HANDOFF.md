# HANDOFF — curbsidesites / main — 2026-08-06 (Session 1: hardening & the trust boundary)

<!--
Written at session end or whenever work changes hands. Keep this comment block.
- The proven/assumed split is the point of this document. "Proven" requires naming
  the check that was actually run and what it showed. Confidence is not proof; a
  claim without a named check goes under Assumed, however sure the author is.
- "Next single action" is singular by design. A list of next steps forces the next
  session to re-decide priorities with less context than the author had; one concrete
  action means it starts working immediately.
-->

## State

`02-BUILD-PROMPT.md` **Session 1** ran. Eight commits on `main`
(`f25fe62`..`e6d283a`), every item from the session's brief addressed in code
and covered by a test that runs in CI. **Nothing is deployed** — the whole
session's output is verified locally against a from-empty database and pushed
to `main`; production still runs the pre-session image.

Two things did not complete, both for reasons outside the code:

1. **The D24 exit criterion (one green CI run) has no run to point at.**
   The root cause was found, fixed, and locally proven, but **GitHub Actions
   was in a `major_outage` for this entire session** (githubstatus.com,
   incident still `investigating` at 22:18Z) and produced no run for any of
   the eight pushed commits. Nothing further can be done from here.
2. **The production cutover is deliberately unstarted.** It changes security
   posture (D23), touches production data (the D21 flag), and deletes a file
   — all house-standard stop-list items. The full ordered procedure with
   acceptance commands is written up as **RUNBOOK 11.5**, including why the
   Worker must deploy before the app.

`npm run verify` now covers five suites that did not exist this morning; it
runs green end to end.

## Proven — checks actually run this session

- **The CI failure is understood and fixed.** Named from the run log
  (run 30966025172, `gh`-equivalent via the Actions API): `control-plane.spec.ts`
  **12.4** (unconsented-transcript refusal) and **12.5** (suspend → restore).
  Both assert against `bayside-detailing` / `sunrise-pool-care`, which only
  `npm run db:seed:fleet` creates — and CI never ran it. It passed locally
  only because dev databases had the fleet seeded by earlier sessions.
  **Verified by:** creating a fresh `curbside_ci` database and replaying the
  exact workflow (migrate → seed → seed:fleet → seed:growth → build →
  playwright) — **49/49 green**, where the old workflow order fails 2.
- **`npm run verify` green end to end** — build clean, `test:rls` 8/8,
  `test:growth` 26/26, `test:boundary` 5/5, `test:domains` 8/8,
  `test:suspend-gate` 3/3, `test:credits` 6/6, `test:e2e` 50/50.
- **The draft-content leak is closed.** The earlier metadata-only patch
  (`174dddc`) did **not** close it — reproduced at that commit: 404 with
  17,465 bytes including business name, phone, service names in the flight
  payload. After the fix: `/`, `/services`, `/contact` all 404 with **zero**
  occurrences of the business name, phone, or tagline, and the body is
  **byte-identical to a nonexistent host** (both 8,344 bytes). The
  `?preview=<token>` handshake still renders in full (200, 43,293 bytes).
- **The tripwire actually catches the bug.** Reverted the fix, rebuilt, ran
  the new test → fails with `/ must not disclose "Bare Demo Diesel"`;
  restored → passes. A test that has never failed proves nothing.
- **D23 is still exploitable in production right now** (pre-deploy baseline,
  read-only GET, 2026-08-06): forged `X-Forwarded-Host` at the bare ACA FQDN
  → **200, 104,824 bytes**; no header → 404; through Cloudflare → 200.
  The fix's behavior is proven at the unit level instead: forged-without-secret
  → 403, wrong secret → 403, correct secret → tenant rewrite, half-configured
  → throws.
- **Intake now sources images.** A real intake submission through the server
  action fires `sourceForIntake` (server log). A real Openverse run through
  the relocated module filled `url` **and** `credit` for every slot and wrote
  slot-named files through the blob seam. Calling it twice produces exactly
  **1** open `source_images` queue item (dedupe holds).
- **Two primary domains are now unrepresentable.** Migration 006 applied to
  two databases; inserting a second primary raises
  `domains_one_primary_per_tenant`. `releaseDomains` clears `is_primary`;
  release → re-provision keeps the registrar (`GoDaddy`, not NULL).
- **Resend's sending domain IS configured** — resolving the ONBOARDING
  contradiction. **Verified by DNS:** `send.curbsidesites.com` has
  `v=spf1 include:amazonses.com ~all` plus Resend's `feedback-smtp` MX,
  `resend._domainkey.curbsidesites.com` carries a DKIM key, DMARC present
  (`p=none`). The apex SPF is Outlook-only, so Resend mail aligns via DKIM,
  which DMARC accepts. ONBOARDING.md updated.
- **D27 is live exactly as recorded.** `www.dubdating.com/robots.txt` serves
  Cloudflare's Managed block (`ai-train=no`, GPTBot/ClaudeBot/CCBot
  `Disallow: /`) prepended to our generated body; the page carries **no**
  robots meta — the fixture is indexable today.
- **Three of five footer-credit targets 404'd** (`/how-it-works`,
  `/care-plans`, `/work`) — resolved against production before changing them;
  all five interim targets now return 200, asserted by `test:credits`.

## Assumed — believed but not verified

- **That any of this works in production.** Every check above ran locally or
  read production read-only. The deployed image is unchanged.
- **That CI will be green.** The workflow was replayed faithfully by hand
  against a from-empty database, but no GitHub-hosted run exists. The Actions
  outage is the only reason.
- **Whether production holds duplicate `is_primary` rows right now** — needs
  the prod DB (the query is in RUNBOOK 11.5 step e). Migration 006 repairs
  them on apply either way.
- **Whether the app's `email` integration is flipped live in production**
  (vs. demo) — DNS is confirmed, the app-side flag is not. Command in
  ONBOARDING's gaps.
- **Whether the draft leak reproduces in production today** — confirmed in
  code at the old commit and fixed; the live repro against a real draft slug
  wasn't run (declined to enumerate real drafts).
- **Actual Azure spend vs. RUNBOOK Appendix A** — unchanged from the last
  handoff; needs `az consumption usage list`.

## Next single action

**Run RUNBOOK 11.5 — the Session 1 cutover** (Worker secret + deploy →
app secret/env → `npm run db:migrate` → image), then work its five
acceptance checks. The one that matters most: the forged-`X-Forwarded-Host`
curl must return **403** at the origin while the same page through
Cloudflare returns **200**. Until that deploy lands, the draft leak and the
open origin are live in production even though both are fixed on `main`.

## After that (context, not commitments)

The other [YOU] items batched for Jason, none blocking:

- **Branch protection on `main`** requiring `verify` — needs one green run
  first (D24), so it waits on the Actions outage clearing.
- **`rm .curbside-env-01`** — the stale world-readable copy in the working
  tree (D28). Confirmed gitignored and never committed; 5,205 bytes, mode
  644. The canonical copy is `~/.curbside-env-01`, mode 600.
- **Three open decisions still need you, and Session 1 could not settle
  them:** **D26** (what a tenant must prove before `status='live'` — the
  image-review pass should probably join it, see ASSUMPTIONS #92),
  **D27** (Managed robots.txt vs. the llms.txt strategy — now with the
  measured interaction below), **D28** (break-glass credentials, second
  alert recipient).
- Then **Session 2** — the platform still cannot bill anyone.

## Known traps

- **A stale `next start` on the port will lie to you.** This session's leak
  fix looked like it had failed because an old server still held :3000/:3100
  — the "leak" was the previous build answering. Kill by PID
  (`lsof -nP -iTCP:3000 -sTCP:LISTEN -t`) before believing any verification.
  README's gotcha list now covers macOS, not just Windows.
- **Deploy order for D23 is not optional.** Worker first (the origin ignores
  an unknown header), app second. Reversed, every request arrives without
  the secret and the whole fleet 403s. Rollback is unsetting
  `EDGE_SHARED_SECRET` (or `TRUST_PROXY_HOST`) on the Container App.
- **`TRUST_PROXY_HOST=1` now throws without `EDGE_SHARED_SECRET`** — that is
  D11's half-configured rule applied deliberately, not a bug. A production
  boot without the secret fails loudly instead of serving forgeable tenancy.
- **The D21 noindex flag works via the meta tag, not robots.txt.**
  Cloudflare's Managed robots.txt prepends `Allow: /`, and for equal-length
  rules the least restrictive wins, so served robots.txt still reads as
  crawlable. That is *necessary here*: the crawler must fetch the page to
  see `noindex`. Do not "fix" the robots.txt half without settling D27 —
  blocking the crawl would strand the fixture in the index permanently.
- **Image sourcing runs fire-and-forget from intake** (the preview link must
  ship immediately). It never throws; failures land as a `source_images`
  item in the staff queue. `SKIP_IMAGE_SOURCING=1` is set in CI so runs
  don't hammer Openverse — the queue item is still recorded.
- **`scripts/lib/image-sourcing.ts` is now a re-export shim.** The real
  module is `src/lib/control/image-sourcing.ts` and it runs on the **control
  role**, not the owner role the old script used.
- Carried from the last handoff and still true: the retired-filename mapping
  in `ARCHITECTURE.md` §0; `wrangler.toml`'s `*/*` route must not be
  reverted; the Worker's ACME passthrough is load-bearing; Postgres 18's
  Docker volume path can silently reset the local DB (#83);
  `~/.curbside-env-01` is zsh-only.
