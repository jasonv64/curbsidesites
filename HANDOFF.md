# HANDOFF — curbsidesites / main — 2026-08-04

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

This was a documents-only session: re-validate the architecture record against
the deployed system, consolidate the doc set, and regenerate the build plan.
An adversarial review (81 checks against code, tests, CI history, DNS, and the
live production surfaces — read-only throughout) drove the changes. Output:
`ARCHITECTURE.md` amended (document map, D8/D15 corrected, §5 rewritten
honestly, §7 status notes, new D21–D28), fifteen markdown files consolidated
to eight (`SPECS.md` = the three plane specs; `RUNBOOK.md` gained COSTS/
CALENDAR/SECRETS as Appendices A–C; `00-`/`01-BUILD-PROMPT.md` →
`02-BUILD-PROMPT.md`), all 90 `ASSUMPTIONS.md` entries dispositioned (2
refuted, 13 carried, rest promoted), `ONBOARDING.md`'s stale gaps reconciled.
**No code was changed and nothing was deployed.** Nothing is committed yet —
the working tree holds the whole change.

## Proven — checks actually run (this session, by the review agent unless noted)

- RLS isolation holds — **verified by:** `npm run test:rls`, 8/8 pass against
  the real dev DB as `curbside_app`, both attack paths.
- CI has never passed — **verified by:** GitHub Actions API, all 5 runs on
  `main` `completed failure`; failing step is the axe/lifecycle e2e. `main`
  has no branch protection.
- The origin honors forged host headers — **verified by:** `curl` to the ACA
  FQDN with `X-Forwarded-Host: iron-ridge-offroad…` → 200, 104,824 bytes;
  no header → 404.
- The fixture ships junk NAP in public structured data, indexable —
  **verified by:** GET www.dubdating.com: JSON-LD `telephone +11231231231`,
  robots `Allow: /`, no noindex, 8 placeholder image refs, 0 blob refs.
- Four of five footer-credit targets 404 — **verified by:** resolving all
  five `CREDITS` hrefs from `src/components/site/footer.tsx` against
  production.
- Deliverability checks look up the wrong host — **verified by:**
  `_dmarc.www.dubdating.com` → empty; `_dmarc.dubdating.com` → GoDaddy
  default `p=quarantine` (reports to the registrar, not us).
- Demo tenants have zero sourced images — **verified by:** read-only SQL
  against the dev DB: 0/10 URLs on both flagship tenants (refutes
  ASSUMPTIONS #31).
- Failover snapshots are current — **verified by:** `HEAD` on both failover
  blobs, `Last-Modified: Tue, 04 Aug 2026 09:00:41 GMT`.
- Doc consolidation lost nothing — **verified by (this session):** pre-merge
  line counts match SPECS.md §-offsets exactly (247/211/157); RUNBOOK
  appendices at lines 1499/1602/1673; repo-wide grep shows no dangling
  references to the six retired filenames outside deliberate "formerly"
  notes; every session heading from 00/01 appears in 02's traceability table.

## Assumed — believed but not verified

- Resend production status — DNS shows a configured sending domain;
  `ONBOARDING.md` said "not set up." Contradiction recorded there; needs
  `/api/status` + `synthetic_checks` with prod access.
- Whether production has duplicate `is_primary` domain rows right now — the
  bug is confirmed in code at HEAD; the prod-DB check
  (`SELECT tenant_id, count(*) FROM domains WHERE is_primary GROUP BY 1
  HAVING count(*)>1`) needs prod access.
- Whether any onboarding call was ever recorded, and whether MSA/consent
  language got attorney review first (RUNBOOK Appendix B #5 — Penal Code
  §632 is criminal) — not answerable from the repo; only Jason knows.
- Actual Azure spend vs. RUNBOOK Appendix A — needs
  `az consumption usage list`.
- The draft-content leak reproducing in prod today — confirmed in code; the
  live repro wasn't run against a real draft slug (declined to enumerate).

## Next single action

Commit this working tree (it is the entire record consolidation, reviewable
as one change), then start `02-BUILD-PROMPT.md` **Session 1**, whose exit
criterion zero is: name the failing e2e test from `gh run view --log-failed`
and get one green CI run on `main`.

## After that (context, not commitments)

Session 1 continues into the trust boundary (D23), the draft leak, intake
image sourcing, the domain fixes (D22), the fixture noindex (D21), and the
[YOU] batch for D26/D27/D28. Then Session 2 (marketing site + billing — the
platform cannot bill anyone today). Sequencing settled by Jason 2026-08-04:
hardening before revenue.

## Known traps

- Six markdown files were retired into `SPECS.md` and RUNBOOK appendices; old
  filenames appear throughout git history and older prose. The mapping lives
  in `ARCHITECTURE.md` §0's document map — "TENANT-APP.md Part 10" =
  "SPECS.md §I Part 10".
- `wrangler.toml`'s `*/*` route must NOT be reverted to explicit patterns —
  client domains stop routing (the file says so inline). Same file: the
  Worker's ACME passthrough is what makes custom-hostname DV possible at all
  (ASSUMPTIONS #87).
- `TRUST_PROXY_HOST=1` is only safe behind a proxy that overwrites
  `X-Forwarded-Host` — and D23 records that the origin currently isn't
  locked, so treat that env var with respect until Session 1 closes it.
- `~/.curbside-env-01` is zsh — sourcing it under bash exits 127. A stale
  world-readable copy sits **inside the working tree** (gitignored); deleting
  it is a Session 1 [YOU] item — don't commit around it blindly.
- Postgres 18's Docker image changed its data-volume path — an image bump
  can silently reset the local DB (ASSUMPTIONS #83).
- CI being red is not new noise from this session's changes — it has failed
  on every run in history. Don't "fix" it by deleting the axe step; that
  step is the D12 gate.
