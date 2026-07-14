/**
 * Host → tenant resolution and the per-tenant render bundle.
 *
 * Three hostname states (TENANT-APP Part 2):
 *   1. custom domain        — exact match in the domains table
 *   2. platform subdomain   — <slug>.$PLATFORM_APEX, works the moment the
 *                             tenant row exists (no domains row needed)
 *   3. unknown host         — null → clean 404
 *
 * Status gates:
 *   draft     → platform subdomain only (custom domain resolves to null)
 *   live      → everything on
 *   suspended → the dignified under-construction page (rendered by layout)
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { platformQuery, withTenant } from "@/lib/db";
import type {
  BrandTokens,
  BusinessProfile,
  ImageRow,
  IntegrationRow,
  ServiceRow,
  TenantRow,
} from "@/lib/schemas";

export type HostKind = "platform" | "custom";

export interface ResolvedTenant {
  tenant: TenantRow;
  hostKind: HostKind;
}

export function platformApex(): string {
  return (process.env.PLATFORM_APEX ?? "localhost").toLowerCase();
}

/** Lowercase, strip port. Host headers arrive as "foo.localhost:3000". */
export function normalizeHost(raw: string): string {
  return raw.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

const TENANT_COLS =
  "id, slug, business_name, status, plan_tier, features, owner_email, preview_token";

/** Uncached resolution — one indexed query either way. */
export async function resolveHostUncached(rawHost: string): Promise<ResolvedTenant | null> {
  const host = normalizeHost(rawHost);
  const apex = platformApex();

  if (host.endsWith(`.${apex}`)) {
    const slug = host.slice(0, -(apex.length + 1));
    if (!/^[a-z0-9-]+$/.test(slug)) return null;
    const rows = await platformQuery<TenantRow>(
      `SELECT ${TENANT_COLS} FROM tenants WHERE slug = $1`,
      [slug]
    );
    if (!rows[0]) return null;
    return { tenant: rows[0], hostKind: "platform" };
  }

  const rows = await platformQuery<TenantRow>(
    `SELECT ${TENANT_COLS.split(", ").map((c) => "t." + c).join(", ")}
       FROM domains d JOIN tenants t ON t.id = d.tenant_id
      WHERE d.hostname = $1`,
    [host]
  );
  if (!rows[0]) return null;
  // Draft tenants exist only on their platform subdomain.
  if (rows[0].status === "draft") return null;
  return { tenant: rows[0], hostKind: "custom" };
}

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

/** Canonical public origin for a tenant (used by sitemap/robots/OG/RSS). */
export function canonicalOrigin(bundle: TenantBundle, hostKind: HostKind, rawHost: string): string {
  const host = normalizeHost(rawHost);
  // Local dev keeps the port so generated URLs stay clickable.
  const port = rawHost.includes(":") ? ":" + rawHost.split(":")[1] : "";
  const proto = host.endsWith("localhost") || host.endsWith(".test") ? "http" : "https";
  return `${proto}://${host}${port}`;
}
