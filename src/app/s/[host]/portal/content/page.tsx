import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getPortalSession } from "@/lib/portal-auth";
import { listAllPosts } from "@/lib/content";
import { formatPostDate } from "@/lib/dates";

/** Post list — drafts and published. Publishing is a DB write (D18). */
export default async function ContentList({ params }: PageProps<"/s/[host]/portal/content">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const session = await getPortalSession(bundle);
  if (!session) redirect("/portal");

  const posts = await listAllPosts(bundle.tenant.id);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-ink">Posts</h2>
        <Link
          href="/portal/content/new"
          className="bg-accent px-5 py-2.5 font-bold text-on-accent transition-opacity hover:opacity-90"
        >
          New post
        </Link>
      </div>
      {posts.length === 0 ? (
        <p className="mt-6 text-ink-muted">No posts yet — write the first one.</p>
      ) : (
        <ul className="mt-6 divide-y-2 divide-edge border-y-2 border-edge">
          {posts.map((post) => (
            <li key={post.slug} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="font-bold text-ink">{post.frontmatter.title}</p>
                <p className="text-sm text-ink-muted">
                  {formatPostDate(post.frontmatter.date)} · /blog/{post.slug} ·{" "}
                  {post.published_at ? "published" : "draft"}
                </p>
              </div>
              <Link
                href={`/portal/content/${post.slug}`}
                className="border-2 border-edge px-4 py-2 text-sm font-bold text-ink hover:border-accent"
              >
                Edit
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
