import { getTenantBundle } from "@/lib/tenant";
import { bestTextOn, resolveTokens } from "@/lib/brand";

/** Per-tenant favicon: brand-colored letter mark, generated (Part 9). */
export async function GET(_req: Request, ctx: RouteContext<"/s/[host]/favicon.svg">) {
  const { host } = await ctx.params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return new Response("Not found", { status: 404 });
  const tokens = resolveTokens(bundle.brand?.tokens);
  const letter = bundle.tenant.business_name.trim().charAt(0).toUpperCase() || "•";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${tokens.brand}"/>
  <rect y="52" width="64" height="12" fill="${tokens.accent}"/>
  <text x="32" y="44" font-family="Arial, sans-serif" font-size="38" font-weight="bold" text-anchor="middle" fill="${bestTextOn(tokens.brand)}">${letter}</text>
</svg>`;
  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
  });
}
