/**
 * One-off: take the dubdating.com simulated client from draft → live
 * (ONBOARDING.md step 5), replicating exactly what a staff member does in the
 * admin UI — no shortcuts past the gates:
 *   1. checkPendingDomains(): poll Cloudflare, mark www.dubdating.com verified.
 *   2. Approve the brand proposal (2.3 gate) — same writes as approveBrandAction:
 *      proposal → approved, and its tokens/font copied into the live `brand` row.
 *   3. maybeGoLive(): flips draft → live now that the brand gate has passed AND
 *      a domain is verified (the real, non-forced path).
 *
 * Env mode: token injected as SECRET_<ref> so the live Cloudflare provider is
 * selected without Key Vault.
 */
import { checkPendingDomains, maybeGoLive } from "@/lib/control/domains";
import { controlOne, controlQuery, revalidateTenant, audit } from "@/lib/control/db";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

async function main() {
  if (!process.env.CLOUDFLARE_ZONE_ID) throw new Error("CLOUDFLARE_ZONE_ID not set");

  const tenant = await controlOne<{ id: string; slug: string; status: string }>(
    "SELECT id, slug, status FROM tenants WHERE slug = 'dub-dates'"
  );
  if (!tenant) throw new Error("dub-dates not found");
  console.log(`tenant ${tenant.slug} status=${tenant.status}`);

  // decided_by is a FK to staff_users.id (a UUID) — use the real staff row,
  // exactly as approveBrandAction does with its session's s.id / s.email.
  const staff = await controlOne<{ id: string; email: string }>(
    "SELECT id, email FROM staff_users ORDER BY created_at LIMIT 1"
  );
  if (!staff) throw new Error("no staff_users row");

  // 1. Verify the domain against Cloudflare.
  const res = await checkPendingDomains();
  console.log(`checkPendingDomains: checked=${res.checked} verified=${res.verified}`);

  // 2. Approve the brand proposal — mirrors approveBrandAction's writes.
  const proposal = await controlOne<{ id: string; tenant_id: string; tokens: unknown; font_pairing_key: string }>(
    "SELECT id, tenant_id, tokens, font_pairing_key FROM brand_proposals WHERE tenant_id = $1 AND status = 'proposed' ORDER BY created_at DESC LIMIT 1",
    [tenant.id]
  );
  if (proposal) {
    await controlQuery(
      "UPDATE brand_proposals SET status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1",
      [proposal.id, staff.id, "approved during dubdating.com go-live simulation"]
    );
    await controlQuery(
      "UPDATE brand SET tokens = $2, font_pairing_key = $3, updated_at = now() WHERE tenant_id = $1",
      [proposal.tenant_id, JSON.stringify(proposal.tokens), proposal.font_pairing_key]
    );
    await audit(staff.email, tenant.id, "brand.approved", { proposal_id: proposal.id });
    console.log("brand proposal approved + tokens copied to live brand row");
  } else {
    console.log("no 'proposed' brand proposal (already approved?)");
  }

  // 3. Flip live (real path: brand approved AND domain verified).
  const go = await maybeGoLive(tenant.id, staff.email);
  console.log("maybeGoLive:", JSON.stringify(go));

  const after = await controlOne<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [tenant.id]);
  console.log(`tenant status now: ${after?.status}`);
  await revalidateTenant("dub-dates");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
