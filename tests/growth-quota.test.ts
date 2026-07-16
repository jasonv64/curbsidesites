/**
 * Quota failure mid-batch (GROWTH-PLANE Part 10.4), against the real DB:
 *
 *   - a vendor dying for tenant A stamps last_error_at on A's integration,
 *     A's cached rows keep serving, and tenant B's fetch is untouched;
 *   - a spent daily budget DEFERS the fetch (no error, no backoff, no
 *     last_error_at) — graceful degradation, not a failed batch.
 *
 * Fetchers are injected; no network. Runs on the same live Postgres as the
 * RLS gate (needs `npm run db:migrate` + docker compose up).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { controlOne, controlQuery } from "@/lib/control/db";
import { withTenant } from "@/lib/db";
import { fetchTenantReviews } from "@/lib/growth/reviews-job";
import { getReviews } from "@/lib/adapters/reviews";

const SLUG_A = "qa-growth-quota-a";
const SLUG_B = "qa-growth-quota-b";
let idA: string;
let idB: string;
const today = () => new Date().toISOString().slice(0, 10);
let priorYelpUsed: number | null = null;

async function makeTenant(slug: string): Promise<string> {
  const row = await controlOne<{ id: string }>(
    `INSERT INTO tenants (slug, business_name, status) VALUES ($1, $2, 'live')
     ON CONFLICT (slug) DO UPDATE SET status = 'live' RETURNING id`,
    [slug, slug]
  );
  await controlQuery(
    `INSERT INTO integrations (tenant_id, key, mode, config, kv_secret_ref)
     VALUES ($1, 'reviews_yelp', 'live', '{"business_id":"qa-biz"}', 'qa-growth-yelp-key')
     ON CONFLICT (tenant_id, key) DO UPDATE SET mode = 'live',
       config = '{"business_id":"qa-biz"}', kv_secret_ref = 'qa-growth-yelp-key',
       last_error_at = NULL, last_error = NULL`,
    [row!.id]
  );
  return row!.id;
}

beforeAll(async () => {
  process.env["SECRET_qa-growth-yelp-key"] = "qa-test-key";
  idA = await makeTenant(SLUG_A);
  idB = await makeTenant(SLUG_B);
  // Tenant A already has a CACHED live review — the thing that must survive.
  await controlQuery(
    `INSERT INTO reviews (tenant_id, source, external_id, author, rating, body, is_demo, published_at)
     VALUES ($1, 'yelp', 'qa-cached-1', 'Cached Reviewer', 5.0, 'Still here after the outage.', false, now() - interval '30 days')
     ON CONFLICT DO NOTHING`,
    [idA]
  );
  const q = await controlOne<{ used: number }>(
    "SELECT used FROM vendor_quotas WHERE vendor = 'yelp' AND day = $1",
    [today()]
  );
  priorYelpUsed = q?.used ?? null;
});

afterAll(async () => {
  await controlQuery("DELETE FROM tenants WHERE slug IN ($1, $2)", [SLUG_A, SLUG_B]);
  // Put the shared quota ledger back the way we found it.
  if (priorYelpUsed === null) {
    await controlQuery("DELETE FROM vendor_quotas WHERE vendor = 'yelp' AND day = $1", [today()]);
  } else {
    await controlQuery("UPDATE vendor_quotas SET used = $2 WHERE vendor = 'yelp' AND day = $1", [
      today(),
      priorYelpUsed,
    ]);
  }
  delete process.env.QUOTA_YELP_PER_DAY;
});

const throwingGoogle = async () => {
  throw new Error("google fetcher must not be called (no google integration in fixture)");
};

describe("vendor failure mid-batch degrades gracefully (Part 10.4, D11)", () => {
  it("tenant A fails without breaking its cache; tenant B fetches normally", async () => {
    process.env.QUOTA_YELP_PER_DAY = "1000";

    // Tenant A: the vendor is on fire.
    const a = await fetchTenantReviews(
      { tenant_id: idA, slug: SLUG_A },
      { google: throwingGoogle, yelp: async () => { throw new Error("Yelp Fusion 429: simulated meltdown"); } }
    );
    expect(a.status).toBe("failed");

    // last_error_at stamped on the integration row (the dashboard's signal).
    const row = await controlOne<{ last_error_at: string | null; last_error: string | null }>(
      "SELECT last_error_at, last_error FROM integrations WHERE tenant_id = $1 AND key = 'reviews_yelp'",
      [idA]
    );
    expect(row?.last_error_at).toBeTruthy();
    expect(row?.last_error).toContain("simulated meltdown");

    // The read path still serves A's cached rows — a dead API never breaks a page.
    const served = await getReviews(idA);
    expect(served.isDemo).toBe(false);
    expect(served.reviews.some((r) => r.author === "Cached Reviewer")).toBe(true);

    // Tenant B, same batch: completely unaffected.
    const b = await fetchTenantReviews(
      { tenant_id: idB, slug: SLUG_B },
      {
        google: throwingGoogle,
        yelp: async (opts) => {
          await withTenant(opts.tenantId, (db) =>
            db.query(
              `INSERT INTO reviews (tenant_id, source, external_id, author, rating, body, is_demo)
               VALUES ($1, 'yelp', 'qa-fresh-1', 'Fresh Reviewer', 4.0, 'Fetched fine.', false)
               ON CONFLICT DO NOTHING`,
              [opts.tenantId]
            )
          );
          return { source: "yelp" as const, fetched: 1 };
        },
      }
    );
    expect(b.status).toBe("ok");
    const bRow = await controlOne<{ last_error_at: string | null }>(
      "SELECT last_error_at FROM integrations WHERE tenant_id = $1 AND key = 'reviews_yelp'",
      [idB]
    );
    expect(bRow?.last_error_at).toBeNull();
    const bServed = await getReviews(idB);
    expect(bServed.reviews.some((r) => r.author === "Fresh Reviewer")).toBe(true);
  });

  it("a spent quota DEFERS instead of failing — no error stamp, no vendor call", async () => {
    process.env.QUOTA_YELP_PER_DAY = "0";
    let vendorCalled = false;
    const result = await fetchTenantReviews(
      { tenant_id: idB, slug: SLUG_B },
      {
        google: throwingGoogle,
        yelp: async () => {
          vendorCalled = true;
          return { source: "yelp" as const, fetched: 0 };
        },
      }
    );
    expect(result.status).toBe("deferred_quota");
    expect(vendorCalled).toBe(false);
    expect(String(result.detail.reviews_yelp)).toContain("daily budget spent");
    // Deferral is not an error: the integration row stays clean.
    const row = await controlOne<{ last_error: string | null }>(
      "SELECT last_error FROM integrations WHERE tenant_id = $1 AND key = 'reviews_yelp'",
      [idB]
    );
    expect(row?.last_error).toBeNull();
  });
});
