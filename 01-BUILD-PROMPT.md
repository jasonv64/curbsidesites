# 01-BUILD-PROMPT.md — ENHANCEMENTS

Everything here assumes `00-BUILD-PROMPT.md` Sessions 1–5 are built, verified, and live. **Nothing here is required to have a business.** When Session 5 is done, Curbside can sell a static site plus a care plan and get paid. These sessions are pulled in when there's a reason — a client asking for a service, or time to polish — not on a schedule.

The invariants in `ARCHITECTURE.md` §7 hold in every session here. Nothing below is permission to weaken tenant isolation, secret handling, the accessibility gate, or NAP consistency. If an enhancement would touch core to serve one tenant, it becomes a feature flag in core (D17), not an exception. Amend the living specs (each spec's §0) as these sessions change reality.

Run them **in order, as separate sessions.** Each has a different mindset and a different acceptance test, and later passes assume earlier ones are done. Session E (activate a service) is the exception — it's run per-service, on demand, whenever a client asks.

**Order and why:** hardening (A) stabilizes before anything extends it; scope cuts (B) shrink the section registry to its best pieces; **presets (C) are composed from that cleaned registry — do them after B or you'll re-author them**; the theme editor (D) is the interface over the same primitives presets use; activation (E) turns stubs live on demand; pricing (F) reconciles the ladder to whatever actually shipped.

---

## SESSION A — HARDENING & CLEANUP

> A stabilization pass. **Change no behavior.** If a change alters what a user sees or an API returns, it doesn't belong here — note it and defer it.
>
> **Read the three `ASSUMPTIONS.md` files first.** Every "don't stop to ask" call made during Sessions 1–3 is a candidate for review. Promote the ones that were right into the specs (amend the living documents per each spec's §0); fix the ones that were wrong.
>
> **Do:**
> - Reconcile duplication across the three planes into shared modules — the data-access layer, the adapter selection logic, the token/render path. One implementation each.
> - Tighten types. Remove every `any` that crept in. Make the Zod schemas the single source they were specified to be, with no parallel hand-written types.
> - Consolidate migrations into a clean, ordered, replayable set. A fresh database from empty must reach the current schema with RLS intact.
> - Raise coverage on the things dangerous to break: the D4 isolation test, the D11 zero-config acceptance test, the semantic health checks, the "aggregateRating only when live" gate. These are regression tripwires; make them impossible to remove silently.
> - Fix every stale or aspirational README line against what the code actually does now — including API specs and where configs live, not just how to set them.
> - **Close the draft-tenant content disclosure.** An anonymous request to a `draft` tenant's platform subdomain returns the correct 404 *status* with ~21KB of that tenant's content still in the *body*: business name in `<title>`, phone, service names, and the owner's verbatim `voice` text from intake. `src/app/s/[host]/layout.tsx` calls `notFound()` correctly, but the layout's async gate and the page render concurrently — Next streams page HTML before the gate resolves, and the flushed markup stays in the response. Slugs are derived predictably from business names, so draft sites are enumerable by guessing. The spec (`src/lib/tenant.ts` header, and the layout's own docstring) says draft content is preview-cookie-only; it isn't. Move the gate ahead of any content rendering — the resolver already runs in `src/proxy.ts`, which is before render — rather than deepening the layout check. **This one does change what a user sees, deliberately: current behavior contradicts the documented invariant.** Regression test belongs with the tripwires above.
>   Reproduce (found while onboarding the `dub-dates` simulated client, 2026-07-18):
>   ```bash
>   curl -s -o /dev/null -w '%{http_code}\n' https://<draft-slug>.sites.curbsidesites.com/   # 404
>   curl -s https://<draft-slug>.sites.curbsidesites.com/ | grep -c '<title>'                # 1 — content leaked
>   ```
>
> - **Every new tenant must arrive with real photos — this is a D11 miss, not a polish item.** D11 requires a zero-config tenant to render "fully browsable, screenshot-ready." It doesn't: `createTenantFromIntake` inserts ~10 `images` rows with `search_query` set but `url` NULL, and sourcing is a separate manual CLI step (`npm run images:source <slug> -- --auto`) that nothing in the intake path calls. Confirmed on the `dub-dates` tenant created through the real form: 10 image rows, 0 with a URL, so the whole site rendered branded SVG placeholders. **The draft site is the sales artifact (2.5)** — a prospect's first look at it is the demo, and placeholders undersell it exactly when it matters most. Wire sourcing into the intake pipeline so a tenant is never *created* without it, and make it write to blob storage rather than the local filesystem — the current `/uploads/<slug>/<file>` output only exists on the machine that ran the CLI, so a locally-sourced tenant still shows placeholders in production. Keep the existing non-fatal degrade (no network → placeholders keep serving), but surface it: a tenant whose images never sourced should raise a `pending_actions` item, not sit silently pretty-looking-in-dev and empty in prod. Preserve `images.credit` alongside `url` — Openverse results are CC BY / CC BY-SA and the credit is what satisfies the licence; a `url` written without a `credit` is a licensing bug.
>
> **Acceptance:** an anonymous request to a draft tenant returns 404 with no tenant content anywhere in the body, and a preview-cookie request still renders in full; a tenant created through the intake form has a real, credited photo in every image slot with no manual step; a fresh clone plus a fresh database boots to two working demo tenants with zero manual steps; the full verify checklists from all three planes pass against a production server; `next build` is clean with no type escapes; every `ASSUMPTIONS.md` entry has been either promoted to a spec or resolved. Report what changed and what you deliberately left alone.

---

## SESSION B — SCOPE & DESIGN CUTS

> **Decide what survives before building more.** The specs prioritize a small number of exceptionally well-executed pages; this pass makes that real by cutting, not adding. Do this before presets (Session C) — presets are composed from the section registry, so shrink it to its best pieces first.
>
> **Do:**
> - Audit every page, section, and component in the tenant app. For each: keep, merge, or cut. A section that exists but never earns its place on a real local-business site is weight — cut it. Fewer, better sections beat a large menu of mediocre ones.
> - Collapse near-duplicate sections into one configurable section (D17 shape).
> - Prune the font-pairing set and the token palette to combinations that actually look good and pass contrast per tenant (D12) — a curated 8, not a ragged 15.
> - Remove dead code paths, unreachable props, and options no real client would use.
>
> **The rule:** every cut is logged with a one-line reason, and every cut section is removed from the registry *and* from any tenant config that referenced it, with a sensible fallback so no live tenant breaks. Cutting a section must not 500 a page that used it.
>
> **Acceptance:** the section registry is smaller and every remaining section is one you'd put in front of a paying client; no tenant renders a broken or empty page as a result of a cut; the cut list is in `ASSUMPTIONS.md` with reasons.

---

## SESSION C — INDUSTRY PRESETS

> Turn the platform from "a website builder" into "the site *for your trade*." An industry preset is a named, sellable starting configuration — **not a new codebase.** It pre-fills the same tenant record the intake form writes: section selection and order, token palette, font pairing, demo copy and image slots, JSON-LD subtype, and the primary conversion action for that trade. One codebase (D1); a preset is data. If a preset ever needs something core lacks, that something becomes a registry section available to every preset (D17), never a fork.
>
> **Build the preset system, then author the first few presets.**
>
> **The system:**
> - A preset is a named record: `key`, display name, description, hero imagery for the curbsidesites.com gallery, and the config bundle it applies.
> - Applying a preset writes a normal `draft` tenant. Everything stays editable afterward — a preset is a starting point, not a lock. The theme editor (Session D) can take it anywhere.
> - Presets compose with, not replace, the invariants: contrast still validated per tenant (D12), NAP still single-homed (§7 #6), demo-vs-live never mixed (§7 #5).
>
> **What makes each preset industry-specific is more than looks — it's the trust and discovery layer:**
> - **Correct JSON-LD subtype per trade** (`AutoRepair`, `TattooParlor`, `GeneralContractor`, `ProfessionalService`, etc.) — this is where the SEO actually lands, and it's the real moat over a pretty template.
> - **The right primary conversion action** — per-artist booking for a tattoo shop, quote-with-photos for a contractor, before/after + seasonal CTA for a solar cleaner, project case studies + credentials for a civil engineer (not a "book now").
> - **The right section mix** — portfolio grid vs. service-area map vs. project case studies — and trade-appropriate demo content that reads as a real business in that industry (§7 #5's realism bar, applied per trade).
>
> **Author these first presets, each complete enough to demo live:**
> Tattoo shop · Mechanic / auto repair · Solar panel cleaning · Civil engineering · Contractor (with landscaping and home-builder as close variants).
>
> Name each one so it sells (the name shows in intake and on the gallery, and it's doing sales work — a shop owner should read it as "that's me," not as an internal codename). Give each real demo imagery per `TENANT-APP.md` Part 10's sourcing-and-review discipline — no invented URLs, a human looks at every image, trade-correct or it's cut.
>
> **Intake integration:** the intake form asks "what's your business?" and uses the answer to *suggest* a preset — never lock it. An explicit "I want the ___ look" (from a visitor who saw it in the gallery) overrides the suggestion. Hybrids and unsure answers fall back to a sensible general preset. All paths just set a starting preset; nothing about this bypasses the brand gate or the editable record.
>
> **curbsidesites.com gallery:** a browsable wall of live industry demos, each a real platform-subdomain tenant a visitor can open and click through, each with a CTA that starts intake pre-seeded with that preset. This is the proof asset — the "imagine your shop, but already built" moment, multiplied across trades — and it feeds directly into the Session 5 live reveal.
>
> **Acceptance:** a visitor picks their trade (or a demo they liked), starts intake, and the live reveal (`00-BUILD-PROMPT.md` Session 5) hands them a demo already shaped for their industry — right sections, right schema subtype, right conversion action, trade-correct imagery. Adding a new industry later is authoring one preset record, zero core changes. Every preset passes the same per-tenant gates as any tenant.

---

## SESSION D — DESIGN-AS-CONFIG EDITOR

> Build the staff-gated theme editor described in `TENANT-APP.md` Part 14. The primitives already exist — sections are config, tokens inject per request, the font pairing is a key, and presets (Session C) prove the config bundle is portable — so this is the interface on top, not new rendering.
>
> Pick sections and order, swap the font pairing key, adjust tokens, preview on the platform subdomain, publish. Gated behind a call with a tech.
>
> **The non-negotiable guardrail: contrast is validated at *write* time, not build time.** The CI gate (D12) runs against whatever tokens existed when the build ran. A token write that would drive a tenant below AA is rejected at the point of the write, with a clear reason. Never a drag-and-drop page builder — that road ends at 200 sites you can't ship a global change to, the exact failure the architecture exists to prevent.
>
> **Acceptance:** a tech can restyle a tenant end to end through the editor; a write that fails contrast is rejected with a clear reason; no editor path can produce a broken or below-AA live tenant.

---

## SESSION E — ACTIVATE A SERVICE (run once PER service, when a client asks)

> **Do not run this pre-emptively.** Each stubbed service is activated the first time a paying client needs it — not before. Activating a service nobody's paying for builds a fake success path and an external account you now maintain for no one.
>
> When a client asks, activate exactly that one service, flip its flag (D19), and write its per-client activation steps into `RUNBOOK.md`. The demo/unconfigured state for every *other* tenant stays honest — never a fake success (D11).
>
> **Dependency reality, so you know what you're signing up for:**
>
> - **AI quote assistant** — code only, Anthropic API already in use. Human-in-the-loop on trade quotes where a wrong number has real cost.
> - **CRM** — code only. Promote the leads inbox to a real pipeline (statuses, notes, filtering), per-tenant, RLS-enforced.
> - **Booking** — code, but real: availability as a source of truth the tenant owns, timezones and double-booking handled explicitly. No fake slots. Genuinely fiddly — budget for it.
> - **Online payments** — Stripe **Connect Standard** (D7). Client is merchant of record; chargeback liability stays with them. Per-client Connect onboarding is a [YOU] runbook step. Unconfigured stays the honest "call the shop to pay" callout.
> - **Call tracking / DNI** — needs real tracking numbers provisioned per client. Assert the NAP invariant (§7 #6) as a test: the tracking number appears in the rendered page only, never in schema, `llms.txt`, citations, or GBP.
> - **Missed-call text-back** — needs Twilio A2P *and* per-client ISV registration (`ARCHITECTURE.md` §6). The biggest compliance lift of the set — this is a client's business messaging that client's customers, so it's per-client brand + campaign registration. Price it accordingly; it is not a quick toggle.
>
> **Acceptance (per service):** it works end to end for the requesting tenant with RLS holding; any unconfigured tenant shows an honest not-live state; the per-client activation steps are in `RUNBOOK.md`.

---

## SESSION F — PRICING & PACKAGING RECONCILIATION

> Runs after anything in Sessions B–E changes what's actually sellable. The billing *engine* already exists (Session 5 of `00-BUILD-PROMPT.md`); this session only reconciles the ladder to reality. Pricing must map onto real feature flags (D19), never aspirational ones.
>
> **Do:**
> - Reconcile Curb / Curb+ / Curb Pro and à la carte add-ons against what's actually live after B–E. Anything sold corresponds to a flag that does something real; anything not yet activated is labeled "available on request" and gated behind its runbook step, not silently sold.
> - Confirm every tier and add-on is a flag on the tenant record, enforced at render and at billing sync, with buying one flipping exactly one flag and no hand-provisioning.
> - Update the curbsidesites.com pricing narrative (Session 5) to match reality to the letter — no feature named on the pricing page that isn't live or honestly labeled as onboard-on-request.
> - Produce `PRICING.md` as the single source of truth: every plan, every add-on, the flag each maps to, the service dependency each carries, and the blended-MRR math updated for what actually ships.
>
> **Acceptance:** every pricing-page line maps to a real flag; buying a plan or add-on in Stripe flips the right flags and provisions nothing by hand; `PRICING.md` and the marketing pricing page agree to the letter; no customer can pay for something that silently doesn't work.
