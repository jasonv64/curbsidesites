import { getTenantBundle } from "@/lib/tenant";
import { resolveTokens } from "@/lib/brand";

/** Per-tenant web manifest, generated from the record (Part 9). */
export async function GET(_req: Request, ctx: RouteContext<"/s/[host]/site.webmanifest">) {
  const { host } = await ctx.params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return new Response("Not found", { status: 404 });
  const tokens = resolveTokens(bundle.brand?.tokens);
  return Response.json(
    {
      name: bundle.tenant.business_name,
      short_name: bundle.tenant.business_name.slice(0, 12),
      start_url: "/",
      display: "browser",
      background_color: tokens.surface,
      theme_color: tokens.brand,
      icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
    },
    { headers: { "Cache-Control": "public, max-age=86400" } }
  );
}
