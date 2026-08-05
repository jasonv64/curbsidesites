/**
 * One-off: connect the dubdating.com simulated client's domain through the
 * REAL code path (ONBOARDING.md step 4). dubdating.com is an apex on GoDaddy,
 * which cannot take an apex CNAME, so we release the apex custom hostname and
 * provision www.dubdating.com instead (CNAME works for a subdomain); the client
 * points the apex at www with GoDaddy Domain Forwarding.
 *
 * Env mode on purpose: token injected as SECRET_<ref> so secretProvider reads
 * it without Key Vault. Resend key intentionally unset → sendPlatformEmail
 * degrades to console so we capture the exact client instructions.
 *
 * Usage: source ~/.curbside-env-01 && env CLOUDFLARE_ZONE_ID=... \
 *          SECRET_curbside-cloudflare-api-token=... npx tsx scripts/provision-dubdates.ts
 */
import { provisionDomain, releaseDomains } from "@/lib/control/domains";
import { controlOne } from "@/lib/control/db";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

const HOSTNAME = "www.dubdating.com";

async function main() {
  if (!process.env.CLOUDFLARE_ZONE_ID) throw new Error("CLOUDFLARE_ZONE_ID not set — would run the DEMO provider");
  if (!process.env["SECRET_curbside-cloudflare-api-token"]) throw new Error("SECRET_curbside-cloudflare-api-token not set");

  const tenant = await controlOne<{ id: string; slug: string; status: string }>(
    "SELECT id, slug, status FROM tenants WHERE slug = $1",
    ["dub-dates"]
  );
  if (!tenant) throw new Error("dub-dates tenant not found");
  console.log(`tenant: ${tenant.slug} (${tenant.id}) status=${tenant.status}`);

  // Clear the apex hostname created in the first pass (it can't validate on
  // GoDaddy). releaseDomains removes the CF custom hostname and marks the row.
  const released = await releaseDomains(tenant.id, "staff:jason");
  console.log(`released: ${released.join(", ") || "(none)"}`);

  await provisionDomain(tenant.id, HOSTNAME, "staff:jason");

  const row = await controlOne(
    `SELECT hostname, is_primary, verification_status, cf_hostname_id, registrar
       FROM domains WHERE hostname = $1`,
    [HOSTNAME]
  );
  console.log("\ndomains row after provision:");
  console.log(JSON.stringify(row, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
