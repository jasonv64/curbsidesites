/**
 * Review aggregation, job side (Part 2, D10). The scheduler decides WHEN a
 * tenant's fetch runs (staggered across a 14-day window); this module decides
 * WHETHER and executes: quota first, then the vendor call, with failures
 * degrading per D11 — cached rows keep serving, last_error_at is stamped,
 * and no other tenant or source is affected.
 *
 * Fetchers are injectable so tests can simulate a quota wall or a dead vendor
 * mid-batch (Part 10.4) without the network.
 */
import { controlQuery } from "@/lib/control/db";
import { secretProvider } from "@/lib/secrets";
import { fetchGoogleReviews, fetchYelpReviews } from "@/lib/adapters/reviews/live";
import { tryConsumeQuota, type RunStatus } from "./scheduler";

export interface ReviewFetchers {
  google: typeof fetchGoogleReviews;
  yelp: typeof fetchYelpReviews;
}

const LIVE_FETCHERS: ReviewFetchers = { google: fetchGoogleReviews, yelp: fetchYelpReviews };

const SOURCES = [
  { key: "reviews_google", vendor: "google_places", configKey: "place_id" },
  { key: "reviews_yelp", vendor: "yelp", configKey: "business_id" },
] as const;

export interface ReviewJobResult {
  status: RunStatus;
  detail: Record<string, unknown>;
}

export async function fetchTenantReviews(
  tenant: { tenant_id: string; slug: string },
  fetchers: ReviewFetchers = LIVE_FETCHERS
): Promise<ReviewJobResult> {
  const rows = await controlQuery<{
    key: string;
    mode: string;
    config: Record<string, string>;
    kv_secret_ref: string | null;
  }>(
    `SELECT key, mode, config, kv_secret_ref FROM integrations
      WHERE tenant_id = $1 AND key IN ('reviews_google','reviews_yelp')`,
    [tenant.tenant_id]
  );

  const detail: Record<string, unknown> = {};
  let failed = 0;
  let deferred = 0;
  let fetched = 0;

  for (const source of SOURCES) {
    const row = rows.find((r) => r.key === source.key);
    if (!row || row.mode !== "live") {
      detail[source.key] = "demo mode — nothing to fetch, read path serves demo rows (D11)";
      continue;
    }
    const configValue = row.config?.[source.configKey];
    const secret = row.kv_secret_ref ? await secretProvider().get(row.kv_secret_ref) : null;
    if (!configValue || !secret) {
      // Half-configured is worse than unconfigured (D11): loud, named fix.
      detail[source.key] =
        `LIVE but ${!configValue ? `config '${source.configKey}'` : `secret '${row.kv_secret_ref}'`} is missing — ` +
        `fix the integration row / secret, or flip mode back to demo`;
      failed++;
      continue;
    }
    // Quota BEFORE the call: a spent budget defers, it never errors.
    const quota = await tryConsumeQuota(source.vendor);
    if (!quota.allow) {
      detail[source.key] = `deferred: ${source.vendor} daily budget spent (cached rows keep serving)`;
      deferred++;
      continue;
    }
    try {
      const result =
        source.key === "reviews_google"
          ? await fetchers.google({ tenantId: tenant.tenant_id, placeId: configValue, apiKey: secret })
          : await fetchers.yelp({ tenantId: tenant.tenant_id, businessId: configValue, apiKey: secret });
      detail[source.key] = `fetched ${result.fetched}`;
      fetched += result.fetched;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      detail[source.key] = `failed: ${message.slice(0, 200)}`;
      failed++;
      // D11: stamp the row; the tenant's page keeps serving cached rows.
      await controlQuery(
        "UPDATE integrations SET last_error_at = now(), last_error = $3, updated_at = now() WHERE tenant_id = $1 AND key = $2",
        [tenant.tenant_id, source.key, message.slice(0, 500)]
      );
    }
  }

  detail.fetched_total = fetched;
  const status: RunStatus = failed > 0 ? "failed" : deferred > 0 ? "deferred_quota" : "ok";
  return { status, detail };
}
