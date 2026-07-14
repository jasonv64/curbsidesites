/**
 * Manual Instagram fetch (D10). Scheduler lands in Session 3; this is the
 * same path run by hand. Usage: npx tsx scripts/fetch-instagram.ts <slug>
 */
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: npx tsx scripts/fetch-instagram.ts <tenant-slug>");
    process.exit(1);
  }
  const { platformQuery, withTenant } = await import("../src/lib/db");
  const { secretProvider } = await import("../src/lib/secrets");
  const { fetchInstagramPosts } = await import("../src/lib/adapters/instagram/live");

  const [tenant] = await platformQuery<{ id: string }>(
    "SELECT id FROM tenants WHERE slug = $1",
    [slug]
  );
  if (!tenant) throw new Error(`no tenant with slug '${slug}'`);

  const [integration] = await withTenant(tenant.id, (db) =>
    db.query("SELECT mode, kv_secret_ref FROM integrations WHERE key = 'instagram'")
  );
  if (!integration || integration.mode !== "live") {
    console.log("instagram: mode=demo — nothing to fetch");
    process.exit(0);
  }
  const token = integration.kv_secret_ref
    ? await secretProvider().get(integration.kv_secret_ref)
    : null;
  if (!token) throw new Error(`instagram secret '${integration.kv_secret_ref}' not populated`);

  const result = await fetchInstagramPosts({ tenantId: tenant.id, accessToken: token });
  console.log(`instagram: cached ${result.fetched} posts`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
