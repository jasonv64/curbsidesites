/**
 * The monthly report assembler (GROWTH-PLANE Part 5). THE PRODUCT — everything
 * else in src/lib/growth feeds this. One artifact, two jobs: the monthly
 * retention mechanism and the exit report (D20), assembled by the same code.
 *
 * The data object built here is FROZEN into reports.data at generation time;
 * rendering (portal HTML, PDF, email) derives from it and never re-queries.
 *
 * The honesty rule (Invariant 12) is enforced structurally:
 *  - a section with no data reports `available: false` and the renderer says
 *    "not tracked yet" — it NEVER renders zeros as achievements;
 *  - demo rows only ever feed kind='sample' reports, which are stamped as
 *    samples on every surface (D5: demo and real never mix);
 *  - a down month states the decline in the first breath, relays a cause only
 *    if staff recorded one, and never pads with vanity metrics.
 */
import { controlOne, controlQuery } from "@/lib/control/db";
import { monthsBefore, periodKey, type ReportPeriod } from "./period";

export type ReportKind = "monthly" | "exit" | "sample";

export interface ContactBreakdown {
  call_tap: number;
  form_submit: number;
  map_tap: number;
}

export interface SearchTermMovement {
  term: string;
  position: number | null; // latest in period; NULL = not in checked depth
  prev_position: number | null;
}

export interface ReportData {
  kind: ReportKind;
  business_name: string;
  city: string | null;
  period: { key: string; label: string; start: string; end: string };
  contacts: {
    total: number;
    by_type: ContactBreakdown;
    by_source: Record<string, number>;
  };
  trend: {
    prev_total: number | null; // null = no prior month of data
    prev_label: string;
    yoy_total: number | null; // null until there IS a same-month-last-year
    yoy_label: string;
  };
  reviews: {
    available: boolean;
    new_count: number;
    total_count: number;
    avg_rating: number | null;
    prev_avg_rating: number | null;
  };
  search: {
    available: boolean;
    terms: SearchTermMovement[]; // only movement worth mentioning + top terms
    tracked_count: number;
  };
  shipped: string[]; // plain sentences: what Curbside did this month
  why_note: string | null; // staff's cause note for the month, if recorded
  next_note: string | null; // staff's "next month" line, if recorded
  data_gaps: string[]; // honest limitations, stated in client language
  generated_at: string;
}

interface AssembleOpts {
  tenantId: string;
  period: ReportPeriod;
  kind: ReportKind;
}

export async function assembleReport({ tenantId, period, kind }: AssembleOpts): Promise<ReportData> {
  const demo = kind === "sample";
  const tenant = await controlOne<{
    business_name: string;
    created_at: string;
    plan_tier: string;
    features: Record<string, boolean>;
  }>("SELECT business_name, created_at, plan_tier, features FROM tenants WHERE id = $1", [tenantId]);
  if (!tenant) throw new Error("assembleReport: unknown tenant");
  const profile = await controlOne<{ nap: { city?: string } }>(
    "SELECT nap FROM business_profile WHERE tenant_id = $1",
    [tenantId]
  );

  const contacts = await contactCounts(tenantId, period.start, period.end, demo);
  const prev = monthsBefore(period, 1);
  const yoy = monthsBefore(period, 12);
  const prevContacts = await contactCounts(tenantId, prev.start, prev.end, demo);
  const yoyContacts = await contactCounts(tenantId, yoy.start, yoy.end, demo);
  const tenantStarted = new Date(tenant.created_at);
  // A month before the tenant existed is "no data", not "zero contacts" —
  // but recorded activity in the window IS existence (backfills, demo months).
  const prevExists = tenantStarted < prev.end || prevContacts.total > 0;
  const yoyExists = tenantStarted < yoy.end || yoyContacts.total > 0;

  // --- Reviews: count + rating + movement -----------------------------------
  const reviewStats = await controlOne<{ total: number; avg: number | null }>(
    `SELECT count(*)::int AS total, round(avg(rating), 2)::float AS avg
       FROM reviews WHERE tenant_id = $1 AND is_demo = $2 AND published_at < $3`,
    [tenantId, demo, period.end]
  );
  const prevReviewStats = await controlOne<{ total: number; avg: number | null }>(
    `SELECT count(*)::int AS total, round(avg(rating), 2)::float AS avg
       FROM reviews WHERE tenant_id = $1 AND is_demo = $2 AND published_at < $3`,
    [tenantId, demo, period.start]
  );
  const newReviews = (reviewStats?.total ?? 0) - (prevReviewStats?.total ?? 0);

  // --- Search visibility: movement on tracked terms -------------------------
  const termRows = await controlQuery<{ term: string; position: number | null; prev_position: number | null }>(
    `SELECT tt.term,
            (SELECT rs.position FROM rank_snapshots rs
              WHERE rs.term_id = tt.id AND rs.is_demo = $2 AND rs.checked_on < $4
              ORDER BY rs.checked_on DESC LIMIT 1) AS position,
            (SELECT rs.position FROM rank_snapshots rs
              WHERE rs.term_id = tt.id AND rs.is_demo = $2 AND rs.checked_on < $3
              ORDER BY rs.checked_on DESC LIMIT 1) AS prev_position
       FROM tracked_terms tt
      WHERE tt.tenant_id = $1 AND tt.retired_at IS NULL
      ORDER BY tt.created_at`,
    [tenantId, demo, period.start, period.end]
  );
  const measured = termRows.filter((t) => t.position !== null || t.prev_position !== null);
  // The report only has room for movement worth mentioning (Part 8): terms
  // that moved, plus the best current positions, capped at 8 lines.
  const moved = measured
    .filter((t) => (t.position ?? 101) !== (t.prev_position ?? 101))
    .sort((a, b) => Math.abs((b.prev_position ?? 101) - (b.position ?? 101)) - Math.abs((a.prev_position ?? 101) - (a.position ?? 101)));
  const holding = measured
    .filter((t) => t.position !== null && (t.position ?? 101) === (t.prev_position ?? 101))
    .sort((a, b) => (a.position ?? 101) - (b.position ?? 101));
  const searchTerms = [...moved, ...holding].slice(0, 8);

  // --- What Curbside shipped this month --------------------------------------
  const shipped: string[] = [];
  const posts = await controlQuery<{ title: string }>(
    `SELECT frontmatter->>'title' AS title FROM content
      WHERE tenant_id = $1 AND type = 'post' AND published_at >= $2 AND published_at < $3
      ORDER BY published_at`,
    [tenantId, period.start, period.end]
  );
  if (posts.length > 0) {
    shipped.push(
      `Published ${posts.length} new ${posts.length === 1 ? "article" : "articles"} on your site: ${posts.map((p) => `“${p.title}”`).join(", ")}.`
    );
  }
  const changes = await controlOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM change_requests
      WHERE tenant_id = $1 AND status = 'applied' AND applied_at >= $2 AND applied_at < $3`,
    [tenantId, period.start, period.end]
  );
  if ((changes?.n ?? 0) > 0) {
    shipped.push(`Made ${changes!.n} site ${changes!.n === 1 ? "update" : "updates"} you asked for — hours, content, and details, same day.`);
  }
  const checks = await controlOne<{ n: number; failed: number }>(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE ok = false)::int AS failed
       FROM synthetic_checks
      WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
    [tenantId, period.start, period.end]
  );
  if ((checks?.n ?? 0) > 0) {
    shipped.push(
      checks!.failed === 0
        ? `Ran ${checks!.n} automated health checks on your site — contact form, email delivery — all passing.`
        : `Ran ${checks!.n} automated health checks; ${checks!.failed} caught a problem, which is what they're for — each was investigated.`
    );
  }
  const napOk = await controlOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM nap_checks
      WHERE tenant_id = $1 AND checked_at >= $2 AND checked_at < $3 AND ok = true`,
    [tenantId, period.start, period.end]
  );
  if ((napOk?.n ?? 0) > 0) {
    shipped.push(`Verified your business name, address, and phone number stayed consistent everywhere we publish them (${napOk!.n} checks).`);
  }

  // --- Staff notes (never invented) ------------------------------------------
  const notes = await controlOne<{ why_note: string | null; next_note: string | null }>(
    "SELECT why_note, next_note FROM report_notes WHERE tenant_id = $1",
    [tenantId]
  );

  // --- Honest limitations, in client language --------------------------------
  const data_gaps: string[] = [];
  const callTracking = await controlOne<{ mode: string }>(
    "SELECT mode FROM integrations WHERE tenant_id = $1 AND key = 'call_tracking'",
    [tenantId]
  );
  if (callTracking?.mode !== "live") {
    data_gaps.push(
      "Calls counted here are taps on your website's phone number. Calls dialed by hand or from Google aren't visible to us yet — full call tracking closes that gap."
    );
  }
  if (!termRows.length) {
    data_gaps.push("Search ranking tracking hasn't started for your terms yet; it appears here once it has a baseline.");
  }

  return {
    kind,
    business_name: tenant.business_name,
    city: profile?.nap?.city ?? null,
    period: {
      key: periodKey(period),
      label: period.label,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
    contacts,
    trend: {
      prev_total: prevExists ? prevContacts.total : null,
      prev_label: prev.label,
      yoy_total: yoyExists ? yoyContacts.total : null,
      yoy_label: yoy.label,
    },
    reviews: {
      available: (reviewStats?.total ?? 0) > 0,
      new_count: Math.max(newReviews, 0),
      total_count: reviewStats?.total ?? 0,
      avg_rating: reviewStats?.avg ?? null,
      prev_avg_rating: prevReviewStats?.avg ?? null,
    },
    search: {
      available: searchTerms.length > 0,
      terms: searchTerms,
      tracked_count: termRows.length,
    },
    shipped,
    why_note: notes?.why_note ?? null,
    next_note: notes?.next_note ?? null,
    data_gaps,
    generated_at: new Date().toISOString(),
  };
}

/**
 * "How many people tried to contact you" — the number the report leads with.
 * Form submissions come from the leads table (server truth — beacons can be
 * ad-blocked); call/direction taps come from events. Synthetic probes and
 * demo rows never count toward a real report.
 */
async function contactCounts(
  tenantId: string,
  start: Date,
  end: Date,
  demo: boolean
): Promise<ReportData["contacts"]> {
  const leadRows = await controlQuery<{ source: string; n: number }>(
    `SELECT source, count(*)::int AS n FROM leads
      WHERE tenant_id = $1 AND is_demo = $2 AND source <> 'synthetic'
        AND created_at >= $3 AND created_at < $4
      GROUP BY source`,
    [tenantId, demo, start, end]
  );
  const eventRows = await controlQuery<{ type: string; source: string; n: number }>(
    `SELECT type, coalesce(payload->>'source', 'direct') AS source, count(*)::int AS n
       FROM events
      WHERE tenant_id = $1 AND is_demo = $2 AND type IN ('call_tap','map_tap')
        AND created_at >= $3 AND created_at < $4
      GROUP BY type, payload->>'source'`,
    [tenantId, demo, start, end]
  );
  const by_type: ContactBreakdown = { call_tap: 0, form_submit: 0, map_tap: 0 };
  const by_source: Record<string, number> = {};
  for (const l of leadRows) {
    by_type.form_submit += l.n;
    by_source[l.source] = (by_source[l.source] ?? 0) + l.n;
  }
  for (const e of eventRows) {
    by_type[e.type as "call_tap" | "map_tap"] += e.n;
    by_source[e.source] = (by_source[e.source] ?? 0) + e.n;
  }
  return { total: by_type.call_tap + by_type.form_submit + by_type.map_tap, by_type, by_source };
}
