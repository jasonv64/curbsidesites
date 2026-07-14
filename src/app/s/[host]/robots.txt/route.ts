import { getTenantBundle, canonicalOrigin } from "@/lib/tenant";

/** Per-tenant robots.txt: allow all, disallow /portal and /api, sitemap link. */
export async function GET(_req: Request, ctx: RouteContext<"/s/[host]/robots.txt">) {
  const { host } = await ctx.params;
  const rawHost = decodeURIComponent(host);
  const bundle = await getTenantBundle(rawHost);
  if (!bundle) return new Response("Not found", { status: 404 });
  const origin = canonicalOrigin(bundle, bundle.hostKind, rawHost);

  // Non-live states and platform subdomains: keep crawlers out entirely.
  const body =
    bundle.tenant.status !== "live" || bundle.hostKind === "platform"
      ? `User-agent: *\nDisallow: /\n`
      : `User-agent: *\nAllow: /\nDisallow: /portal\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=3600" },
  });
}
