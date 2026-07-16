import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getPortalSession } from "@/lib/portal-auth";
import { withTenant } from "@/lib/db";
import type { ReportData } from "@/lib/growth/report";

interface ReportListRow {
  id: string;
  kind: "monthly" | "exit" | "sample";
  data: ReportData;
  generated_at: string;
  sent_at: string | null;
}

/** /portal/reports — every report ever sent, newest first (GROWTH Part 5). */
export default async function ReportsPage({ params }: PageProps<"/s/[host]/portal/reports">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const session = await getPortalSession(bundle);
  if (!session) redirect("/portal");

  const reports = await withTenant(bundle.tenant.id, (db) =>
    db.query<ReportListRow>(
      `SELECT id, kind, data, generated_at, sent_at FROM reports
        ORDER BY period_start DESC, generated_at DESC LIMIT 36`
    )
  );

  return (
    <div>
      <h2 className="font-display text-2xl text-ink">Monthly reports</h2>
      <p className="mt-2 max-w-2xl text-ink-muted">
        One number a month: how many people tried to contact you, and where they came from.
        Every figure is measured, never estimated.
      </p>
      {reports.length === 0 ? (
        <p className="mt-6 border-2 border-edge bg-surface-raised p-4 text-sm text-ink-muted">
          Your first report arrives after your first full calendar month — there&apos;s nothing
          honest to show before then.
        </p>
      ) : (
        <ul className="mt-6 max-w-2xl divide-y-2 divide-edge border-y-2 border-edge">
          {reports.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-4">
              <div>
                <Link
                  href={`/portal/reports/${r.id}`}
                  className="font-bold text-accent underline underline-offset-4"
                >
                  {r.kind === "exit" ? "Final report" : r.data.period.label}
                </Link>
                <span className="block text-xs text-ink-muted">
                  {r.data.contacts.total} people tried to contact you
                  {r.kind === "sample" ? " · sample data" : ""}
                </span>
              </div>
              <span className="shrink-0 border-2 border-edge px-2 py-0.5 text-xs font-bold uppercase text-ink-muted">
                {r.kind === "sample" ? "sample" : r.sent_at ? "delivered" : "preview"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
