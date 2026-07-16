/**
 * NAP drift monitor (Part 7). Drift is silent and costs rankings without ever
 * producing an error — a client edits hours on GBP directly, a directory
 * rewrites a suite number, and nobody notices for six months.
 *
 * Canonical NAP has exactly one home: business_profile.nap (Invariant 6).
 * Each check compares a surface against it and writes a nap_checks row:
 *   ok=true   surface matches
 *   ok=false  DRIFT — also raises a staff alert
 *   ok=NULL   surface unavailable (GBP in demo mode) — never faked as a pass
 *
 * Surfaces v1: our own generated citation surfaces (JSON-LD, llms.txt — which
 * also proves DNI never leaked into them) and GBP via the adapter. Yelp and
 * the directories join as their adapters gain read scopes.
 */
import { controlOne, controlQuery } from "@/lib/control/db";
import { notifyStaff } from "@/lib/control/notify";
import { localBusinessJsonLd, llmsTxt } from "@/lib/seo";
import { getGbpSnapshot } from "@/lib/adapters/gbp";
import type { TenantBundle } from "@/lib/tenant";
import type { RunStatus } from "./scheduler";

const normPhone = (s: string) => s.replace(/[^\d+]/g, "").replace(/^\+?1/, "");
const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

interface CanonicalNap {
  name: string;
  phone_display: string;
  phone_tel: string;
  street: string;
  city: string;
  region: string;
  postal: string;
}

export async function checkNapDrift(tenant: {
  tenant_id: string;
  slug: string;
  business_name: string;
}): Promise<{ status: RunStatus; detail: Record<string, unknown> }> {
  const profile = await controlOne<TenantBundle["profile"] & { nap: CanonicalNap }>(
    `SELECT nap, hours, geo, socials, service_area, schema_subtype, tagline, about
       FROM business_profile WHERE tenant_id = $1`,
    [tenant.tenant_id]
  );
  if (!profile) return { status: "skipped", detail: { reason: "no business_profile yet" } };
  const services = await controlQuery<{ slug: string; name: string; blurb: string }>(
    "SELECT slug, name, blurb FROM services WHERE tenant_id = $1 ORDER BY sort_order",
    [tenant.tenant_id]
  );
  const canonical = profile.nap;
  const detail: Record<string, unknown> = {};
  let drifted = 0;

  // A minimal bundle: the SEO builders read tenant identity + profile +
  // services only. This runs the REAL builders — the same code that renders.
  const bundle = {
    tenant: { slug: tenant.slug, business_name: tenant.business_name },
    profile,
    services,
    sections: [],
    images: [],
    integrations: [],
    brand: null,
  } as unknown as TenantBundle;
  const origin = `https://${tenant.slug}.example`;

  // --- Surface 1: JSON-LD ----------------------------------------------------
  const graph = (localBusinessJsonLd(bundle, origin, null) as { "@graph"?: Record<string, unknown>[] })["@graph"];
  const biz = graph?.[0] as
    | { name?: string; telephone?: string; address?: { streetAddress?: string; addressLocality?: string } }
    | undefined;
  const jsonldOk = Boolean(
    biz &&
      normText(biz.name ?? "") === normText(canonical.name) &&
      normPhone(biz.telephone ?? "") === normPhone(canonical.phone_tel) &&
      normText(biz.address?.streetAddress ?? "") === normText(canonical.street)
  );
  await writeCheck(tenant.tenant_id, "site_jsonld", jsonldOk, canonical, {
    name: biz?.name,
    telephone: biz?.telephone,
    street: biz?.address?.streetAddress,
  });
  detail.site_jsonld = jsonldOk;
  if (!jsonldOk) drifted++;

  // --- Surface 2: llms.txt -----------------------------------------------------
  const llms = llmsTxt(bundle, origin);
  const llmsOk =
    llms.includes(canonical.phone_display) && llms.toLowerCase().includes(canonical.name.toLowerCase());
  await writeCheck(tenant.tenant_id, "site_llms_txt", llmsOk, canonical, {
    contains_display_phone: llms.includes(canonical.phone_display),
  });
  detail.site_llms_txt = llmsOk;
  if (!llmsOk) drifted++;

  // --- Surface 3: GBP ----------------------------------------------------------
  const gbp = await getGbpSnapshot(tenant.tenant_id, tenant.slug);
  if (!gbp.available) {
    await writeCheck(tenant.tenant_id, "gbp", null, canonical, { note: "gbp integration in demo mode — not checked" });
    detail.gbp = "unchecked (demo)";
  } else {
    const gbpOk = Boolean(
      gbp.nap &&
        normText(gbp.nap.name) === normText(canonical.name) &&
        normPhone(gbp.nap.phone) === normPhone(canonical.phone_tel) &&
        normText(gbp.nap.street) === normText(canonical.street) &&
        normText(gbp.nap.city) === normText(canonical.city)
    );
    await writeCheck(tenant.tenant_id, "gbp", gbpOk, canonical, { ...(gbp.nap ?? {}) });
    detail.gbp = gbpOk;
    if (!gbpOk) drifted++;
  }

  if (drifted > 0) {
    await notifyStaff({
      tenantId: tenant.tenant_id,
      kind: "nap_drift",
      severity: "warn",
      message: `${tenant.slug}: NAP drift detected on ${drifted} surface(s) — silent ranking damage until fixed`,
      detail,
    });
  }
  return { status: "ok", detail };
}

async function writeCheck(
  tenantId: string,
  surface: string,
  ok: boolean | null,
  expected: CanonicalNap,
  observed: Record<string, unknown> | null
): Promise<void> {
  await controlQuery(
    `INSERT INTO nap_checks (tenant_id, surface, ok, expected, observed) VALUES ($1, $2, $3, $4, $5)`,
    [
      tenantId,
      surface,
      ok,
      JSON.stringify({ name: expected.name, phone: expected.phone_tel, street: expected.street, city: expected.city }),
      observed ? JSON.stringify(observed) : null,
    ]
  );
}
