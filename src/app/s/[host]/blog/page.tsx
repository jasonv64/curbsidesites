import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { listPublishedPosts } from "@/lib/content";
import { formatPostDate, readingTimeMinutes } from "@/lib/dates";

export async function generateMetadata({ params }: PageProps<"/s/[host]/blog">): Promise<Metadata> {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return {};
  return {
    title: "Blog",
    description: `Guides and shop news from ${bundle.tenant.business_name}${bundle.profile ? ` in ${bundle.profile.nap.city}, ${bundle.profile.nap.region}` : ""}.`,
  };
}

export default async function BlogIndex({
  params,
  searchParams,
}: PageProps<"/s/[host]/blog">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();

  const posts = await listPublishedPosts(bundle.tenant.id);
  const sp = await searchParams;
  const activeTag = typeof sp.tag === "string" ? sp.tag : null;
  const tags = [...new Set(posts.flatMap((p) => p.frontmatter.tags ?? []))].sort();
  const shown = activeTag
    ? posts.filter((p) => (p.frontmatter.tags ?? []).includes(activeTag))
    : posts;

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
      <h1 className="font-display text-5xl text-ink sm:text-6xl">Blog</h1>

      {tags.length > 0 ? (
        <nav aria-label="Filter posts by tag" className="mt-8 flex flex-wrap gap-2">
          <Link
            href="/blog"
            className={`border-2 px-3 py-1.5 text-sm font-bold ${!activeTag ? "border-accent text-accent" : "border-edge text-ink-muted hover:border-accent"}`}
          >
            All
          </Link>
          {tags.map((t) => (
            <Link
              key={t}
              href={`/blog?tag=${encodeURIComponent(t)}`}
              className={`border-2 px-3 py-1.5 text-sm font-bold ${activeTag === t ? "border-accent text-accent" : "border-edge text-ink-muted hover:border-accent"}`}
            >
              {t}
            </Link>
          ))}
        </nav>
      ) : null}

      {shown.length === 0 ? (
        <p className="mt-10 text-lg text-ink-muted">
          Nothing here yet — first posts are on the way.
        </p>
      ) : (
        <ul className="mt-10 divide-y-2 divide-edge border-y-2 border-edge">
          {shown.map((post) => (
            <li key={post.slug} className="py-8">
              <article>
                <p className="text-sm font-semibold text-ink-muted">
                  {/* date pinned to noon — never new Date("YYYY-MM-DD") */}
                  <time dateTime={post.frontmatter.date}>{formatPostDate(post.frontmatter.date)}</time>
                  {" · "}
                  {readingTimeMinutes(post.body)} min read
                </p>
                <h2 className="font-display mt-2 text-3xl text-ink">
                  <Link href={`/blog/${post.slug}`} className="hover:text-accent">
                    {post.frontmatter.title}
                  </Link>
                </h2>
                <p className="mt-2 max-w-3xl text-ink-muted">{post.frontmatter.description}</p>
                <Link
                  href={`/blog/${post.slug}`}
                  className="mt-3 inline-block font-bold text-accent underline underline-offset-4"
                >
                  Read it →
                </Link>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
