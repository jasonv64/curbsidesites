import Link from "next/link";
import { notFound } from "next/navigation";
import { controlOne } from "@/lib/control/db";
import { renderReportHtml } from "@/lib/growth/report-html";
import type { ReportData } from "@/lib/growth/report";

export const dynamic = "force-dynamic";

/**
 * Staff view of one report — the EXACT artifact the client sees (rendered
 * from the frozen data). This is where "read it as if you were the shop
 * owner" happens before hitting Send.
 */
export default async function AdminReportView({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const report = await controlOne<{ data: ReportData; sent_at: string | null; pdf_path: string | null }>(
    `SELECT r.data, r.sent_at, r.pdf_path FROM reports r
       JOIN tenants t ON t.id = r.tenant_id WHERE r.id = $1 AND t.slug = $2`,
    [id, slug]
  );
  if (!report) notFound();
  const d = report.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-2xl">
          {d.business_name} — {d.kind === "exit" ? "final report" : d.period.label} ({d.kind})
        </h1>
        <Link href={`/tenants/${slug}`} className="text-sm font-semibold text-accent underline">
          ← back to tenant
        </Link>
      </div>
      <p className="text-sm text-ink-muted">
        {report.sent_at
          ? `Sent ${new Date(report.sent_at).toISOString().slice(0, 10)} — immutable.`
          : "Not sent yet. Read it standing up, on a phone, as if the invoice were yours: does the first number answer “did this make me money?”"}
        {report.pdf_path ? ` PDF: ${report.pdf_path}` : ""}
      </p>
      <iframe
        srcDoc={renderReportHtml(d)}
        sandbox=""
        title={`${d.period.label} report`}
        className="h-[75rem] w-full rounded border border-edge bg-white"
      />
    </div>
  );
}
