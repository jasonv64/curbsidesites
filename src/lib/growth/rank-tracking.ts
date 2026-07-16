/**
 * Rank tracking (Part 8). Modest is the operative word: at most 20 terms per
 * tenant (service + city beats vanity head terms), refreshed weekly by the
 * scheduler, feeding the report's search-visibility section.
 *
 * No SERP vendor is named in ARCHITECTURE D3, so live mode is an interface
 * with a loud unimplemented seam (same posture as payments/booking): flip the
 * 'rank_tracking' integration live before implementing fetchLiveRanks and you
 * get a HalfConfigured-style throw naming this file. Demo mode generates
 * deterministic, plausible snapshots flagged is_demo — they feed ONLY
 * kind='sample' reports (D5).
 */
import { controlOne, controlQuery } from "@/lib/control/db";
import { hash32, type RunStatus } from "./scheduler";

export const MAX_TRACKED_TERMS = 20;

/**
 * Seed the term set from what actually wins jobs in this market:
 * "<service> <city>" per service, plus "<service> near me" up to the cap.
 */
export async function ensureTrackedTerms(tenantId: string): Promise<number> {
  const existing = await controlOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM tracked_terms WHERE tenant_id = $1 AND retired_at IS NULL",
    [tenantId]
  );
  if ((existing?.n ?? 0) > 0) return 0;

  const profile = await controlOne<{ nap: { city?: string } }>(
    "SELECT nap FROM business_profile WHERE tenant_id = $1",
    [tenantId]
  );
  const city = profile?.nap?.city;
  if (!city) return 0;
  const services = await controlQuery<{ name: string }>(
    "SELECT name FROM services WHERE tenant_id = $1 ORDER BY sort_order",
    [tenantId]
  );
  const terms: string[] = [];
  for (const s of services) terms.push(`${s.name.toLowerCase()} ${city.toLowerCase()}`);
  for (const s of services) terms.push(`${s.name.toLowerCase()} near me`);
  let created = 0;
  for (const term of terms.slice(0, MAX_TRACKED_TERMS)) {
    const res = await controlQuery(
      "INSERT INTO tracked_terms (tenant_id, term) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id",
      [tenantId, term]
    );
    created += res.length;
  }
  return created;
}

/** Add/retire terms by hand (admin). The cap is enforced here, not hoped for. */
export async function addTrackedTerm(tenantId: string, term: string): Promise<void> {
  const active = await controlOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM tracked_terms WHERE tenant_id = $1 AND retired_at IS NULL",
    [tenantId]
  );
  if ((active?.n ?? 0) >= MAX_TRACKED_TERMS) {
    throw new Error(
      `Term cap reached (${MAX_TRACKED_TERMS}). Retire a term first — twenty terms that matter beat two hundred that don't (Part 8).`
    );
  }
  await controlQuery(
    `INSERT INTO tracked_terms (tenant_id, term) VALUES ($1, $2)
     ON CONFLICT (tenant_id, term) DO UPDATE SET retired_at = NULL`,
    [tenantId, term.toLowerCase().trim()]
  );
}

export async function retireTrackedTerm(tenantId: string, termId: string): Promise<void> {
  await controlQuery(
    "UPDATE tracked_terms SET retired_at = now() WHERE id = $1 AND tenant_id = $2",
    [termId, tenantId]
  );
}

// ---------------------------------------------------------------------------
// Weekly refresh
// ---------------------------------------------------------------------------

export async function refreshRanks(tenant: {
  tenant_id: string;
  slug: string;
}): Promise<{ status: RunStatus; detail: Record<string, unknown> }> {
  await ensureTrackedTerms(tenant.tenant_id);
  const integration = await controlOne<{ mode: string; config: Record<string, string> }>(
    "SELECT mode, config FROM integrations WHERE tenant_id = $1 AND key = 'rank_tracking'",
    [tenant.tenant_id]
  );
  const terms = await controlQuery<{ id: string; term: string }>(
    "SELECT id, term FROM tracked_terms WHERE tenant_id = $1 AND retired_at IS NULL ORDER BY created_at",
    [tenant.tenant_id]
  );
  if (terms.length === 0) return { status: "skipped", detail: { reason: "no tracked terms (no city or services yet)" } };

  if (integration?.mode === "live") {
    // Interface now, live later — and loudly unimplemented until then (D11).
    throw new Error(
      `rank_tracking is flagged LIVE for '${tenant.slug}' but no SERP vendor is implemented. ` +
        `Pick a vendor (record it in ASSUMPTIONS.md per D3), implement fetchLiveRanks() in ` +
        `src/lib/growth/rank-tracking.ts, and store its key at the integration's kv_secret_ref. ` +
        `Until then flip the integration back to demo.`
    );
  }

  // Demo snapshots: deterministic per term+week, drifting slowly and
  // plausibly upward — realistic movement for the SAMPLE report, worthless
  // and clearly flagged (is_demo) for anything else.
  let written = 0;
  const week = Math.floor(Date.now() / (7 * 24 * 3600_000));
  for (const t of terms) {
    const position = demoPosition(t.term, week);
    const res = await controlQuery(
      `INSERT INTO rank_snapshots (tenant_id, term_id, position, checked_on, is_demo)
       VALUES ($1, $2, $3, CURRENT_DATE, true)
       ON CONFLICT (term_id, checked_on) DO NOTHING RETURNING id`,
      [tenant.tenant_id, t.id, position]
    );
    written += res.length;
  }
  return { status: "ok", detail: { mode: "demo", terms: terms.length, snapshots_written: written } };
}

/**
 * A believable trajectory: each term starts somewhere in #8–#40 and grinds
 * toward a term-specific floor with small week-to-week wobble. Deterministic
 * (term + week in, position out) so re-seeds and tests reproduce.
 */
export function demoPosition(term: string, week: number, weeksTracked = 26): number | null {
  const h = hash32(term);
  const start = 8 + (h % 33); // 8..40
  const floor = 1 + (h % 7); // 1..7
  const speed = 0.35 + ((h >>> 8) % 100) / 250; // 0.35..0.75 positions/week
  const age = Math.max(week % weeksTracked, 0);
  const wobble = ((hash32(`${term}:${week}`) % 5) - 2) * 0.6; // -1.2..+1.2
  const pos = Math.round(Math.max(start - age * speed + wobble, floor));
  // A term occasionally falls out of the checked depth — reports must cope.
  if (hash32(`${term}:${week}:out`) % 41 === 0) return null;
  return Math.min(Math.max(pos, 1), 100);
}
