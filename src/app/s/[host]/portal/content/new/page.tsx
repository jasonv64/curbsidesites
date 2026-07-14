import { notFound, redirect } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getPortalSession } from "@/lib/portal-auth";
import { PostEditor } from "@/components/portal/portal-forms";

export default async function NewPost({ params }: PageProps<"/s/[host]/portal/content/new">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const session = await getPortalSession(bundle);
  if (!session) redirect("/portal");
  return (
    <div>
      <h2 className="font-display text-2xl text-ink">New post</h2>
      <div className="mt-6">
        <PostEditor post={null} />
      </div>
    </div>
  );
}
