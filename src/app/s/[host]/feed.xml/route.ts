import { getTenantBundle, canonicalOrigin } from "@/lib/tenant";
import { listPublishedPosts } from "@/lib/content";

/** RSS 2.0 feed of published posts (Part 8). */
export async function GET(_req: Request, ctx: RouteContext<"/s/[host]/feed.xml">) {
  const { host } = await ctx.params;
  const rawHost = decodeURIComponent(host);
  const bundle = await getTenantBundle(rawHost);
  if (!bundle || bundle.tenant.status !== "live") {
    return new Response("Not found", { status: 404 });
  }
  const origin = canonicalOrigin(bundle, bundle.hostKind, rawHost);
  const posts = await listPublishedPosts(bundle.tenant.id);
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const items = posts
    .map((p) => {
      const [y, m, d] = p.frontmatter.date.split("-").map(Number);
      const pubDate = new Date(y, m - 1, d, 12).toUTCString(); // noon-pinned
      return `    <item>
      <title>${esc(p.frontmatter.title)}</title>
      <link>${origin}/blog/${p.slug}</link>
      <guid>${origin}/blog/${p.slug}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${esc(p.frontmatter.description)}</description>
    </item>`;
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(bundle.tenant.business_name)}</title>
    <link>${origin}</link>
    <description>${esc(`Guides and news from ${bundle.tenant.business_name}`)}</description>
    <language>en-us</language>
${items}
  </channel>
</rss>`;

  return new Response(body, {
    headers: { "Content-Type": "application/rss+xml", "Cache-Control": "public, max-age=3600" },
  });
}
