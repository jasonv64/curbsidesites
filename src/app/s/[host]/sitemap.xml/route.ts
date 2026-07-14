import { getTenantBundle, canonicalOrigin } from "@/lib/tenant";
import { listPublishedPosts } from "@/lib/content";

/**
 * Per-tenant sitemap (Part 9): every page and post FOR THIS TENANT ONLY,
 * lastModified from the record. New content appears with zero extra steps.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/s/[host]/sitemap.xml">
) {
  const { host } = await ctx.params;
  const rawHost = decodeURIComponent(host);
  const bundle = await getTenantBundle(rawHost);
  if (!bundle) return new Response("Not found", { status: 404 });
  // Draft/suspended and platform subdomains are noindex — empty sitemap.
  if (bundle.tenant.status !== "live" || bundle.hostKind === "platform") {
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`);
  }

  const origin = canonicalOrigin(bundle, bundle.hostKind, rawHost);
  const posts = await listPublishedPosts(bundle.tenant.id);
  const now = new Date().toISOString().slice(0, 10);

  const urls: { loc: string; lastmod: string }[] = [
    { loc: `${origin}/`, lastmod: now },
    { loc: `${origin}/services`, lastmod: now },
    { loc: `${origin}/about`, lastmod: now },
    { loc: `${origin}/gallery`, lastmod: now },
    { loc: `${origin}/contact`, lastmod: now },
    { loc: `${origin}/blog`, lastmod: now },
    { loc: `${origin}/privacy`, lastmod: now },
    { loc: `${origin}/terms`, lastmod: now },
    { loc: `${origin}/accessibility`, lastmod: now },
    ...posts.map((p) => ({
      loc: `${origin}/blog/${p.slug}`,
      // pg returns timestamptz as a Date object
      lastmod: p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 10) : p.frontmatter.date,
    })),
  ];

  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n")}
</urlset>`);
}

function xml(body: string) {
  return new Response(body, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
  });
}
