/**
 * Manual review fetch (D10: jobs call vendors, tenants read our rows).
 * The staggered, quota-aware SCHEDULER ships with the growth plane
 * (Session 3, GROWTH-PLANE.md Part 2); this script is the same fetch path,
 * run by hand — it's how a freshly-configured reviews integration lights up
 * today with zero code changes.
 *
 * Usage: npx tsx scripts/fetch-reviews.ts <tenant-slug>
 */
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: npx tsx scripts/fetch-reviews.ts <tenant-slug>");
    process.exit(1);
  }
  // Import after dotenv so DATABASE_URL is set.
  const { platformQuery, withTenant } = await import("../src/lib/db");
  const { secretProvider } = await import("../src/lib/secrets");
  const { fetchGoogleReviews, fetchYelpReviews } = await import("../src/lib/adapters/reviews/live");

  const [tenant] = await platformQuery<{ id: string }>(
    "SELECT id FROM tenants WHERE slug = $1",
    [slug]
  );
  if (!tenant) throw new Error(`no tenant with slug '${slug}'`);

  const integrations = await withTenant(tenant.id, (db) =>
    db.query(
      "SELECT key, mode, config, kv_secret_ref FROM integrations WHERE key IN ('reviews_google','reviews_yelp')"
    )
  );

  for (const integration of integrations) {
    if (integration.mode !== "live") {
      console.log(`${integration.key}: mode=demo — skipped`);
      continue;
    }
    const secret = integration.kv_secret_ref
      ? await secretProvider().get(integration.kv_secret_ref)
      : null;
    if (!secret) {
      console.error(`${integration.key}: LIVE but secret '${integration.kv_secret_ref}' not populated — fix before running`);
      continue;
    }
    try {
      const result =
        integration.key === "reviews_google"
          ? await fetchGoogleReviews({ tenantId: tenant.id, placeId: integration.config.place_id, apiKey: secret })
          : await fetchYelpReviews({ tenantId: tenant.id, businessId: integration.config.business_id, apiKey: secret });
      console.log(`${integration.key}: fetched ${result.fetched} reviews`);
    } catch (e) {
      console.error(`${integration.key}: fetch failed —`, e instanceof Error ? e.message : e);
      await withTenant(tenant.id, (db) =>
        db.query(
          "UPDATE integrations SET last_error_at = now(), last_error = $2 WHERE tenant_id = $1 AND key = $3",
          [tenant.id, e instanceof Error ? e.message.slice(0, 500) : String(e), integration.key]
        )
      );
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
