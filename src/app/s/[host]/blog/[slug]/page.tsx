import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantBundle, canonicalOrigin } from "@/lib/tenant";
import { getPublishedPost } from "@/lib/content";
import { formatPostDate, readingTimeMinutes } from "@/lib/dates";
import { articleJsonLd } from "@/lib/seo";
import { Markdown } from "@/components/markdown";

export async function generateMetadata({
  params,
}: PageProps<"/s/[host]/blog/[slug]">): Promise<Metadata> {
  const { host, slug } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return {};
  const post = await getPublishedPost(bundle.tenant.id, slug);
  if (!post) return {};
  return {
    title: post.frontmatter.title,
    description: post.frontmatter.description,
    openGraph: {
      type: "article",
      title: post.frontmatter.title,
      description: post.frontmatter.description,
      publishedTime: post.frontmatter.date,
      authors: [post.frontmatter.author],
      images: [{ url: `/og?title=${encodeURIComponent(post.frontmatter.title)}`, width: 1200, height: 630 }],
    },
    alternates: { canonical: `./${slug}` },
  };
}

export default async function BlogPost({ params }: PageProps<"/s/[host]/blog/[slug]">) {
  const { host, slug } = await params;
  const rawHost = decodeURIComponent(host);
  const bundle = await getTenantBundle(rawHost);
  if (!bundle) notFound();
  const post = await getPublishedPost(bundle.tenant.id, slug);
  if (!post) notFound();

  const origin = canonicalOrigin(bundle, bundle.hostKind, rawHost);
  const jsonLd = articleJsonLd(bundle, origin, post);

  return (
    <article className="mx-auto max-w-6xl px-4 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-ink-muted">
          <time dateTime={post.frontmatter.date}>{formatPostDate(post.frontmatter.date)}</time>
          {" · "}
          {readingTimeMinutes(post.body)} min read
          {" · "}
          {post.frontmatter.author}
        </p>
        <h1 className="font-display mt-3 text-4xl text-ink sm:text-6xl">
          {post.frontmatter.title}
        </h1>
        {(post.frontmatter.tags ?? []).length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Tags">
            {post.frontmatter.tags.map((t) => (
              <li key={t}>
                <Link
                  href={`/blog?tag=${encodeURIComponent(t)}`}
                  className="border-2 border-edge px-3 py-1 text-xs font-bold text-ink-muted hover:border-accent"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-8">
          <Markdown body={post.body} />
        </div>
        <p className="mt-12 border-t-2 border-edge pt-6">
          <Link href="/contact#quote" className="font-bold text-accent underline underline-offset-4">
            Questions about your setup? Get a straight answer →
          </Link>
        </p>
      </div>
    </article>
  );
}
