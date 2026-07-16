/**
 * The growth-plane scheduler (Parts 2, 9.3). Three ideas, all explicit and
 * unit-tested in tests/growth-scheduler.test.ts:
 *
 *  STAGGER  — per-tenant work spreads deterministically across each job's
 *             window. 200 tenants never hit Yelp in the same hour, and a
 *             review nine days "late" costs nobody anything (Part 2).
 *  QUOTA    — a per-vendor daily budget. When it's spent, remaining work is
 *             DEFERRED (not failed): rescheduled a few hours out, no error,
 *             no backoff, other tenants unaffected.
 *  BACKOFF  — real failures back off exponentially per tenant+job and record
 *             last_error_at on the integration row; the read path keeps
 *             serving cached rows throughout (D11: demo is the failure mode).
 *
 * The pure decision functions live at the top; DB glue below.
 */
import { controlOne, controlQuery } from "@/lib/control/db";

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

export type GrowthJob =
  | "reviews_fetch"
  | "rank_tracking"
  | "nap_drift"
  | "review_solicitation"
  | "content_calendar"
  | "monthly_report";

/** Each job's cadence window in hours (the stagger spreads inside it). */
export const JOB_WINDOW_HOURS: Record<GrowthJob, number> = {
  reviews_fetch: 14 * 24, // weekly-to-monthly per Part 2; 14d window
  rank_tracking: 7 * 24, // weekly (Part 8)
  nap_drift: 7 * 24, // weekly (Part 7)
  review_solicitation: 24, // daily scan for due asks
  content_calendar: 0, // monthly, anchored to the 1st (special-cased)
  monthly_report: 0, // monthly, anchored to the 2nd (special-cased)
};

/** FNV-1a — a stable small hash; crypto not needed, determinism is. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Where in the job's window this tenant runs: a deterministic offset in
 * [0, windowMs). Same tenant+job → same slot every cycle; different jobs
 * for the same tenant land in different slots.
 */
export function staggerOffsetMs(tenantId: string, job: GrowthJob, windowMs: number): number {
  if (windowMs <= 0) return 0;
  return hash32(`${tenantId}:${job}`) % windowMs;
}

/**
 * The next run after a SUCCESSFUL one: the tenant's slot in the next window.
 * Anchoring windows to epoch keeps slots absolute — a job that ran late
 * doesn't drift the whole schedule later forever.
 */
export function nextRunAfterSuccess(tenantId: string, job: GrowthJob, now: Date): Date {
  const windowMs = JOB_WINDOW_HOURS[job] * 3600_000;
  if (windowMs <= 0) throw new Error(`${job} is month-anchored — use nextMonthlyRun`);
  const offset = staggerOffsetMs(tenantId, job, windowMs);
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  let next = windowStart + offset;
  while (next <= now.getTime()) next += windowMs;
  return new Date(next);
}

/**
 * Month-anchored jobs run once per calendar month on/after their anchor day,
 * staggered across a few days so 200 report generations don't collide.
 */
export function nextMonthlyRun(tenantId: string, job: GrowthJob, anchorDay: number, now: Date): Date {
  const spreadMs = 4 * 24 * 3600_000; // spread across 4 days after the anchor
  const offset = staggerOffsetMs(tenantId, job, spreadMs);
  const candidate = (y: number, m: number) => Date.UTC(y, m, anchorDay) + offset;
  let t = candidate(now.getUTCFullYear(), now.getUTCMonth());
  if (t <= now.getTime()) t = candidate(now.getUTCFullYear(), now.getUTCMonth() + 1);
  return new Date(t);
}

/** Exponential backoff after a real failure: 30min · 2^level, capped at 24h. */
export function backoffDelayMs(level: number): number {
  return Math.min(30 * 60_000 * 2 ** Math.max(level, 0), 24 * 3600_000);
}

/** Quota deferral: try again in 6h — usually a fresh vendor-day by then. */
export const QUOTA_DEFER_MS = 6 * 3600_000;

export interface QuotaDecision {
  allow: boolean;
  remaining: number;
}

/** Pure budget check: `used` so far today vs the vendor's daily budget. */
export function quotaDecision(used: number, budget: number, need = 1): QuotaDecision {
  const remaining = Math.max(budget - used, 0);
  return { allow: remaining >= need, remaining };
}

/** Daily budgets, overridable per environment. Deliberately conservative. */
export function vendorBudget(vendor: string): number {
  const env = process.env[`QUOTA_${vendor.toUpperCase()}_PER_DAY`];
  if (env && Number.isFinite(Number(env))) return Number(env);
  const defaults: Record<string, number> = {
    yelp: 250, // Fusion free tier is 300/day; leave headroom
    google_places: 500,
    rank_vendor: 200,
    gbp: 300,
  };
  return defaults[vendor] ?? 100;
}

// ---------------------------------------------------------------------------
// DB glue
// ---------------------------------------------------------------------------

export const ALL_JOBS: GrowthJob[] = [
  "reviews_fetch",
  "rank_tracking",
  "nap_drift",
  "review_solicitation",
  "content_calendar",
  "monthly_report",
];

/**
 * Make sure every live/draft tenant has a schedule row per job. First run is
 * the tenant's staggered slot, not "now" — a freshly seeded fleet must not
 * thunder on the first jobs tick.
 */
export async function ensureSchedules(now = new Date()): Promise<number> {
  const tenants = await controlQuery<{ id: string }>(
    "SELECT id FROM tenants WHERE status IN ('draft','live')"
  );
  let created = 0;
  for (const t of tenants) {
    for (const job of ALL_JOBS) {
      const firstRun =
        job === "content_calendar"
          ? nextMonthlyRun(t.id, job, 1, now)
          : job === "monthly_report"
            ? nextMonthlyRun(t.id, job, 2, now)
            : nextRunAfterSuccess(t.id, job, now);
      const res = await controlQuery(
        `INSERT INTO growth_schedule (tenant_id, job, next_run_at)
         VALUES ($1, $2, $3) ON CONFLICT (tenant_id, job) DO NOTHING RETURNING id`,
        [t.id, job, firstRun]
      );
      created += res.length;
    }
  }
  return created;
}

export interface DueJob {
  id: string;
  tenant_id: string;
  slug: string;
  status: string;
  plan_tier: string;
  features: Record<string, boolean>;
  owner_email: string | null;
  business_name: string;
  job: GrowthJob;
  backoff_level: number;
}

export async function dueJobs(now = new Date(), limit = 200): Promise<DueJob[]> {
  return controlQuery<DueJob>(
    `SELECT gs.id, gs.tenant_id, gs.job, gs.backoff_level,
            t.slug, t.status, t.plan_tier, t.features, t.owner_email, t.business_name
       FROM growth_schedule gs JOIN tenants t ON t.id = gs.tenant_id
      WHERE gs.next_run_at <= $1 AND t.status IN ('draft','live')
      ORDER BY gs.next_run_at LIMIT $2`,
    [now, limit]
  );
}

export type RunStatus = "ok" | "failed" | "deferred_quota" | "skipped";

/** Record a run and compute the next slot per outcome. */
export async function recordRun(
  due: DueJob,
  status: RunStatus,
  detail: Record<string, unknown>,
  now = new Date()
): Promise<void> {
  let next: Date;
  let backoff = 0;
  if (status === "failed") {
    backoff = due.backoff_level + 1;
    next = new Date(now.getTime() + backoffDelayMs(due.backoff_level));
  } else if (status === "deferred_quota") {
    backoff = due.backoff_level; // quota is not a failure
    next = new Date(now.getTime() + QUOTA_DEFER_MS);
  } else if (due.job === "content_calendar") {
    next = nextMonthlyRun(due.tenant_id, due.job, 1, now);
  } else if (due.job === "monthly_report") {
    next = nextMonthlyRun(due.tenant_id, due.job, 2, now);
  } else {
    next = nextRunAfterSuccess(due.tenant_id, due.job, now);
  }
  await controlQuery(
    `UPDATE growth_schedule
        SET last_run_at = $2, last_status = $3, last_detail = $4,
            backoff_level = $5, next_run_at = $6, updated_at = now()
      WHERE id = $1`,
    [due.id, now, status, JSON.stringify(detail), backoff, next]
  );
}

/**
 * Consume vendor quota for today (UTC vendor-days). Returns whether the call
 * may proceed; on false the caller defers, never errors.
 */
export async function tryConsumeQuota(vendor: string, need = 1): Promise<QuotaDecision> {
  const day = new Date().toISOString().slice(0, 10);
  const budget = vendorBudget(vendor);
  const row = await controlOne<{ used: number }>(
    `INSERT INTO vendor_quotas (vendor, day, used) VALUES ($1, $2, 0)
     ON CONFLICT (vendor, day) DO UPDATE SET used = vendor_quotas.used
     RETURNING used`,
    [vendor, day]
  );
  const decision = quotaDecision(row?.used ?? 0, budget, need);
  if (decision.allow) {
    await controlQuery(`UPDATE vendor_quotas SET used = used + $3 WHERE vendor = $1 AND day = $2`, [
      vendor,
      day,
      need,
    ]);
  }
  return decision;
}
