import { notFound, redirect } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getPortalSession } from "@/lib/portal-auth";
import { withTenant } from "@/lib/db";
import type { ContentRow } from "@/lib/schemas";
import { PostEditor } from "@/components/portal/portal-forms";

export default async function EditPost({
  params,
}: PageProps<"/s/[host]/portal/content/[slug]">) {
  const { host, slug } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const session = await getPortalSession(bundle);
  if (!session) redirect("/portal");

  const post = await withTenant(bundle.tenant.id, (db) =>
    db.one<ContentRow>(
      `SELECT id, type, slug, frontmatter, body, published_at, updated_at
         FROM content WHERE type = 'post' AND slug = $1`,
      [slug]
    )
  );
  if (!post) notFound();

  return (
    <div>
      <h2 className="font-display text-2xl text-ink">Edit: {post.frontmatter.title}</h2>
      <div className="mt-6">
        <PostEditor post={post} />
      </div>
    </div>
  );
}
