import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getPortalSession } from "@/lib/portal-auth";
import { withTenant } from "@/lib/db";
import { renderReportHtml } from "@/lib/growth/report-html";
import type { ReportData } from "@/lib/growth/report";

/**
 * One report, rendered from its FROZEN data (the numbers a client read never
 * change under them). The document is self-contained HTML, so it renders in
 * a sandboxed iframe — deliberately outside the tenant's brand styling: the
 * report is Curbside's artifact, identical here, in email, and as the PDF.
 */
export default async function ReportViewPage({ params }: PageProps<"/s/[host]/portal/reports/[id]">) {
  const { host, id } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const session = await getPortalSession(bundle);
  if (!session) redirect("/portal");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const report = await withTenant(bundle.tenant.id, (db) =>
    db.one<{ data: ReportData }>("SELECT data FROM reports WHERE id = $1", [id])
  );
  if (!report) notFound();
  const d = report.data;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl text-ink">
          {d.kind === "exit" ? "Final report" : `${d.period.label} report`}
        </h2>
        <Link href="/portal/reports" className="text-sm font-bold text-accent underline underline-offset-4">
          ← All reports
        </Link>
      </div>
      <iframe
        srcDoc={renderReportHtml(d)}
        sandbox=""
        title={`${d.period.label} report for ${d.business_name}`}
        className="mt-6 h-[70rem] w-full border-2 border-edge bg-white"
      />
    </div>
  );
}
