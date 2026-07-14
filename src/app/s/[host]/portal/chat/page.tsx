import { notFound, redirect } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getPortalSession } from "@/lib/portal-auth";
import { ChatUi } from "@/components/portal/chat-ui";

/** The change-request chat (D9). AI proposes; the CLIENT confirms. */
export default async function ChatPage({ params }: PageProps<"/s/[host]/portal/chat">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const session = await getPortalSession(bundle);
  if (!session) redirect("/portal");

  return (
    <div>
      <h2 className="font-display text-2xl text-ink">Request a change</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        Say it in plain words. You&apos;ll get a confirmation of exactly what will change before
        anything touches your live site; anything we can&apos;t do automatically goes straight to
        the Curbside team.
      </p>
      <div className="mt-6">
        <ChatUi />
      </div>
    </div>
  );
}
