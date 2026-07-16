import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getPortalSession } from "@/lib/portal-auth";
import { withTenant } from "@/lib/db";
import { formatPostDate } from "@/lib/dates";
import { LoginForm } from "@/components/portal/portal-forms";
import { logout } from "./actions";

interface RecentLead {
  id: string;
  name: string;
  service: string | null;
  status: string;
  created_at: string;
}
interface RecentPost {
  slug: string;
  frontmatter: { title: string; date: string };
  published_at: string | null;
}
interface RecentChange {
  raw_message: string;
  status: string;
  created_at: string;
}

const CHANGE_LABEL: Record<string, string> = {
  applied: "applied",
  pending: "awaiting your confirmation",
  rejected: "cancelled",
  escalated: "with the Curbside team",
  confirmed: "confirmed",
};

/** /portal — login when signed out, overview when signed in. */
export default async function PortalHome({
  params,
  searchParams,
}: PageProps<"/s/[host]/portal">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const session = await getPortalSession(bundle);
  const sp = await searchParams;

  if (!session) {
    return (
      <div>
        <h2 className="font-display text-2xl text-ink">Sign in</h2>
        <p className="mt-2 max-w-md text-ink-muted">
          No passwords here — enter the owner email on file and we&apos;ll send a one-time
          sign-in link.
        </p>
        {sp.link === "expired" ? (
          <p role="alert" className="mt-3 max-w-md border-2 border-accent bg-surface-raised p-3 text-sm text-ink">
            That link expired or was already used. Request a fresh one below.
          </p>
        ) : null}
        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    );
  }

  const data = await withTenant(bundle.tenant.id, async (db) => {
    const newLeads = await db.one("SELECT count(*)::int AS n FROM leads WHERE is_demo = false AND status = 'new'");
    const subs = await db.one("SELECT count(*)::int AS n FROM subscribers WHERE is_demo = false");
    // 30-day conversions (D14): the numbers that mean "did the site produce work".
    // Real events only; a tenant with none yet shows the seeded sample numbers
    // with the quiet label — never both in one view (D5).
    let demoConversions = false;
    let conversions = await db.query(
      `SELECT type, count(*)::int AS n FROM events
        WHERE created_at > now() - interval '30 days' AND is_demo = false
          AND type IN ('call_tap','form_submit','map_tap')
        GROUP BY type`
    );
    if (conversions.length === 0) {
      conversions = await db.query(
        `SELECT type, count(*)::int AS n FROM events
          WHERE created_at > now() - interval '30 days' AND is_demo = true
            AND type IN ('call_tap','form_submit','map_tap')
          GROUP BY type`
      );
      demoConversions = conversions.length > 0;
    }
    const recentLeads = await db.query<RecentLead>(
      `SELECT id, name, service, status, created_at FROM leads
        WHERE is_demo = false ORDER BY created_at DESC LIMIT 5`
    );
    const posts = await db.query<RecentPost>(
      `SELECT slug, frontmatter, published_at FROM content
        WHERE type = 'post' ORDER BY (frontmatter->>'date') DESC LIMIT 6`
    );
    const changes = await db.query<RecentChange>(
      `SELECT raw_message, status, created_at FROM change_requests
        ORDER BY created_at DESC LIMIT 5`
    );
    return { newLeads: newLeads?.n ?? 0, subs: subs?.n ?? 0, conversions, demoConversions, recentLeads, posts, changes };
  });

  const conv = (type: string) => data.conversions.find((c) => c.type === type)?.n ?? 0;
  const tiles = [
    { label: "Calls tapped, last 30 days", value: conv("call_tap") },
    { label: "Quote requests, last 30 days", value: conv("form_submit") },
    { label: "Direction taps, last 30 days", value: conv("map_tap") },
    { label: "New leads waiting", value: data.newLeads },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-muted">
          Signed in as <span className="font-bold text-ink">{session.email}</span>
        </p>
        <form action={logout}>
          <button type="submit" className="border-2 border-edge px-4 py-2 text-sm font-bold text-ink hover:border-accent">
            Sign out
          </button>
        </form>
      </div>

      {/* The month at a glance — business outcomes, not pageviews (D14) */}
      {data.demoConversions ? (
        <p className="mt-6 border-2 border-edge bg-surface-raised p-3 text-sm text-ink-muted">
          Sample numbers — live tracking replaces these the moment your site records real activity.
        </p>
      ) : null}
      <dl className="mt-6 grid gap-px border-2 border-edge bg-edge sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="bg-surface p-6">
            <dd className="font-display text-4xl text-accent">{t.value}</dd>
            <dt className="mt-1 text-sm font-semibold text-ink-muted">{t.label}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="recent-leads-h">
          <div className="flex items-baseline justify-between">
            <h2 id="recent-leads-h" className="font-display text-2xl text-ink">Latest leads</h2>
            <Link href="/portal/leads" className="text-sm font-bold text-accent underline underline-offset-4">
              All leads →
            </Link>
          </div>
          {data.recentLeads.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              No real leads yet — they&apos;ll appear here the moment the site&apos;s form is used.
            </p>
          ) : (
            <ul className="mt-3 divide-y-2 divide-edge border-y-2 border-edge">
              {data.recentLeads.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <span className="font-bold text-ink">{lead.name}</span>
                    {lead.service ? <span className="text-ink-muted"> — {lead.service}</span> : null}
                    <span className="block text-xs text-ink-muted">
                      {new Date(lead.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <span className="shrink-0 border-2 border-edge px-2 py-0.5 text-xs font-bold uppercase text-ink-muted">
                    {lead.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="posts-h">
          <div className="flex items-baseline justify-between">
            <h2 id="posts-h" className="font-display text-2xl text-ink">Posts</h2>
            <Link href="/portal/content" className="text-sm font-bold text-accent underline underline-offset-4">
              Manage posts →
            </Link>
          </div>
          {data.posts.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">No posts yet — write the first one.</p>
          ) : (
            <ul className="mt-3 divide-y-2 divide-edge border-y-2 border-edge">
              {data.posts.map((post) => (
                <li key={post.slug} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <span className="font-bold text-ink">{post.frontmatter.title}</span>
                    <span className="block text-xs text-ink-muted">
                      {formatPostDate(post.frontmatter.date)} · {post.published_at ? "published" : "draft"}
                    </span>
                  </div>
                  {post.published_at ? (
                    <Link
                      href={`/blog/${post.slug}`}
                      className="shrink-0 text-xs font-bold text-accent underline underline-offset-4"
                    >
                      View live
                    </Link>
                  ) : (
                    <Link
                      href={`/portal/content/${post.slug}`}
                      className="shrink-0 text-xs font-bold text-accent underline underline-offset-4"
                    >
                      Edit draft
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="changes-h" className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 id="changes-h" className="font-display text-2xl text-ink">Recent site changes</h2>
          <Link href="/portal/chat" className="text-sm font-bold text-accent underline underline-offset-4">
            Request a change →
          </Link>
        </div>
        {data.changes.length === 0 ? (
          <p className="mt-3 max-w-2xl text-sm text-ink-muted">
            Nothing yet. Say it in plain words — &quot;make Saturday 8 to 2&quot; — confirm, done.
            Unlimited edits are part of your plan.
          </p>
        ) : (
          <ul className="mt-3 max-w-3xl divide-y-2 divide-edge border-y-2 border-edge">
            {data.changes.map((change, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <span className="text-ink">&quot;{change.raw_message}&quot;</span>
                  <span className="block text-xs text-ink-muted">
                    {new Date(change.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
                <span className="shrink-0 border-2 border-edge px-2 py-0.5 text-xs font-bold uppercase text-ink-muted">
                  {CHANGE_LABEL[change.status] ?? change.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-sm text-ink-muted">
        Subscribers on your newsletter list: <span className="font-bold text-ink">{data.subs}</span>
      </p>
    </div>
  );
}
