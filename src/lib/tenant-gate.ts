/**
 * Host → tenant-row resolution, importable from src/proxy.ts.
 *
 * Split out of src/lib/tenant.ts so the proxy (Node runtime, but its own
 * module graph) can resolve a host without dragging in react/next-cache.
 * tenant.ts re-exports everything here — app code keeps importing tenant.ts.
 *
 * Three hostname states (SPECS.md §I Part 2):
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
import { platformQuery } from "@/lib/db";
import type { TenantRow } from "@/lib/schemas";

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

/**
 * The host-visibility gate, run in the proxy BEFORE anything renders.
 *
 * The layout also gates drafts, but Next streams the page concurrently with
 * the layout's notFound() — the flushed markup (business name, phone,
 * services, intake voice text) stayed in the 404 body. Draft content is
 * preview-cookie-only (SPECS.md §I Part 2), so the gate must run where no
 * content can have rendered yet: here.
 *
 * Returns true when the request must be blocked:
 *   - unknown host (no tenant, no domains row — and custom-domain drafts,
 *     which the resolver already treats as unknown), or
 *   - draft tenant with a missing or wrong preview cookie.
 * Blocking both through the same path keeps a gated draft byte-identical to
 * a host that doesn't exist — draft slugs derive predictably from business
 * names, so a distinguishable 404 would make drafts enumerable.
 *
 * Fails OPEN on database errors: with the DB down the layout can't render
 * tenant content anyway, and failing closed would 404 the whole fleet on a
 * transient blip while the edge Worker's failover needs to see the 5xx.
 */
export async function hostBlocked(
  rawHost: string,
  previewCookie: string | null | undefined
): Promise<boolean> {
  try {
    const resolved = await resolveHostUncached(rawHost);
    if (!resolved) return true;
    if (resolved.tenant.status !== "draft") return false;
    return previewCookie !== resolved.tenant.preview_token;
  } catch (e) {
    console.error("[tenant-gate] host gate query failed; passing through", e);
    return false;
  }
}
