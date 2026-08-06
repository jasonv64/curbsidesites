/**
 * Host → tenant resolution and the per-tenant render bundle.
 *
 * Host resolution itself lives in src/lib/tenant-gate.ts (re-exported here)
 * so the proxy can run the draft-visibility gate without importing
 * react/next-cache. This file owns the cached render bundle.
 *
 * Status gates:
 *   draft     → platform subdomain only (resolver), preview cookie enforced
 *               in src/proxy.ts BEFORE render (and again in the layout)
 *   live      → everything on
 *   suspended → the dignified under-construction page (rendered by layout)
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { withTenant } from "@/lib/db";
import { normalizeHost, resolveHostUncached } from "@/lib/tenant-gate";
import type {
  BrandTokens,
  BusinessProfile,
  ImageRow,
  IntegrationRow,
  ServiceRow,
  TenantRow,
} from "@/lib/schemas";

export {
  platformApex,
  normalizeHost,
  resolveHostUncached,
  type HostKind,
  type ResolvedTenant,
} from "@/lib/tenant-gate";
import type { HostKind } from "@/lib/tenant-gate";

/** Per-request memo for pages/layouts sharing one resolution. */
export const resolveHost = cache(resolveHostUncached);

// ---------------------------------------------------------------------------
// The render bundle: everything a page needs that lives on the tenant record.
// Cached with tag `tenant:<slug>` (TENANT-APP Part 4) — one shop editing its
// hours revalidates one shop's cache.
// ---------------------------------------------------------------------------

export interface TenantBundle {
  tenant: TenantRow;
  profile: BusinessProfile | null;
  brand: { tokens: BrandTokens; font_pairing_key: string; logo_url: string | null } | null;
  services: ServiceRow[];
  sections: { page: string; section_name: string; sort_order: number; props: Record<string, unknown> }[];
  images: ImageRow[];
  integrations: Pick<IntegrationRow, "key" | "mode" | "config">[];
}

export function tenantTag(slug: string): string {
  return `tenant:${slug}`;
}

async function loadBundle(tenantId: string, tenant: TenantRow): Promise<TenantBundle> {
  return withTenant(tenantId, async (db) => {
    // Sequential on purpose: one transaction = one client; pg queues (and
    // deprecates) concurrent queries on a single connection.
    const profile = await db.one("SELECT nap, hours, geo, socials, service_area, schema_subtype, tagline, about FROM business_profile WHERE tenant_id = $1", [tenantId]);
    const brand = await db.one("SELECT tokens, font_pairing_key, logo_url FROM brand WHERE tenant_id = $1", [tenantId]);
    const services = await db.query<ServiceRow>("SELECT id, slug, name, blurb, body, sort_order FROM services ORDER BY sort_order, name");
    const sections = await db.query("SELECT page, section_name, sort_order, props FROM sections ORDER BY page, sort_order");
    const images = await db.query<ImageRow>("SELECT slot_id, purpose, aspect, alt, url, credit FROM images");
    const integrations = await db.query("SELECT key, mode, config FROM integrations");
    return {
      tenant,
      profile: (profile as BusinessProfile | null) ?? null,
      brand: (brand as TenantBundle["brand"]) ?? null,
      services,
      sections: sections as TenantBundle["sections"],
      images,
      integrations: integrations as TenantBundle["integrations"],
    };
  });
}

export type ResolvedBundle = TenantBundle & { hostKind: HostKind };

/**
 * Host → full bundle, ISR-cached per tenant. Layouts and pages call this.
 * Returns null for unknown hosts (the [host] layout 404s).
 */
export const getTenantBundle = cache(async (rawHost: string): Promise<ResolvedBundle | null> => {
  const resolved = await resolveHost(rawHost);
  if (!resolved) return null;
  const { tenant, hostKind } = resolved;
  const cached = unstable_cache(
    () => loadBundle(tenant.id, tenant),
    ["tenant-bundle", tenant.id],
    { tags: [tenantTag(tenant.slug)], revalidate: 600 }
  );
  // The tenant row itself is ALWAYS the fresh one from host resolution —
  // status flips (suspend, draft) and preview tokens must take effect on the
  // next request, not when a 600s cache window happens to roll over.
  return { ...(await cached()), tenant, hostKind };
});

/**
 * Should this render be kept out of search indexes? True for anything not
 * live, for every platform subdomain (the sales/preview surface — the custom
 * domain is the only indexable copy), and for tenants carrying the `noindex`
 * feature flag — the D17-shaped switch D21 uses to keep the dub-dates
 * fixture (live, real domain, fabricated NAP) out of Google without
 * special-casing it in core.
 */
export function tenantNoindex(tenant: TenantRow, hostKind: HostKind): boolean {
  return tenant.status !== "live" || hostKind === "platform" || tenant.features?.noindex === true;
}

/** Canonical public origin for a tenant (used by sitemap/robots/OG/RSS). */
export function canonicalOrigin(bundle: TenantBundle, hostKind: HostKind, rawHost: string): string {
  const host = normalizeHost(rawHost);
  // Local dev keeps the port so generated URLs stay clickable.
  const port = rawHost.includes(":") ? ":" + rawHost.split(":")[1] : "";
  const proto = host.endsWith("localhost") || host.endsWith(".test") ? "http" : "https";
  return `${proto}://${host}${port}`;
}
