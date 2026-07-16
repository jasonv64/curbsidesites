/**
 * Report lifecycle: generate (freeze data), render, PDF, send. Job- and
 * script-side only (control role) — the portal READS reports, it never
 * generates them.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { audit, controlOne, controlQuery } from "@/lib/control/db";
import { sendPlatformEmail } from "@/lib/control/notify";
import { monthPeriod, periodKey, tzMidnight, type ReportPeriod } from "./period";
import { assembleReport, type ReportData, type ReportKind } from "./report";
import { renderReportHtml } from "./report-html";

export interface StoredReport {
  id: string;
  kind: ReportKind;
  period_start: string;
  data: ReportData;
  generated_at: string;
  sent_at: string | null;
  pdf_path: string | null;
}

/**
 * Generate and freeze a report. Regenerating an UNSENT report replaces it
 * (numbers improve as instrumentation lands); a SENT report is immutable —
 * the client already read it, so a regeneration attempt is refused.
 */
export async function generateReport(
  tenantId: string,
  period: ReportPeriod,
  kind: ReportKind,
  actor: string
): Promise<StoredReport> {
  const existing = await controlOne<{ id: string; sent_at: string | null }>(
    "SELECT id, sent_at FROM reports WHERE tenant_id = $1 AND kind = $2 AND period_start = $3",
    [tenantId, kind, period.start]
  );
  if (existing?.sent_at) {
    throw new Error(
      `A ${kind} report for ${period.label} was already sent — sent reports are immutable. ` +
        `If the numbers were wrong, generate next month's report with a correction in the notes.`
    );
  }
  const data = await assembleReport({ tenantId, period, kind });
  const row = await controlOne<StoredReport>(
    `INSERT INTO reports (tenant_id, kind, period_start, period_end, data)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, kind, period_start)
     DO UPDATE SET data = $5, period_end = $4, generated_at = now()
     RETURNING id, kind, period_start, data, generated_at, sent_at, pdf_path`,
    [tenantId, kind, period.start, period.end, JSON.stringify(data)]
  );
  await audit(actor, tenantId, "report.generated", { kind, period: periodKey(period) });
  return row!;
}

/**
 * PDF via Playwright's bundled Chromium (a devDependency that exists for the
 * e2e suite). Script/job context only. When Playwright isn't installed (a
 * production container without dev deps), we skip HONESTLY: the report is
 * still generated, portal-rendered, and emailed with a link — pdf_path stays
 * NULL and the caller's summary says so. Session 4 decides the production
 * PDF path (Playwright in the jobs image, or Browserless).
 */
export async function renderReportPdf(reportId: string): Promise<string | null> {
  const report = await controlOne<{ data: ReportData; tenant_slug: string }>(
    `SELECT r.data, t.slug AS tenant_slug FROM reports r JOIN tenants t ON t.id = r.tenant_id WHERE r.id = $1`,
    [reportId]
  );
  if (!report) throw new Error("renderReportPdf: no such report");
  let chromium;
  try {
    // The repo ships @playwright/test for e2e; plain playwright also works.
    ({ chromium } = await import("@playwright/test").catch(() => import("playwright")));
  } catch {
    console.warn("[report] playwright not available — skipping PDF (HTML + portal still serve)");
    return null;
  }
  const dir = join(process.cwd(), ".data", "reports", report.tenant_slug);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${report.data.period.key}-${report.data.kind}.pdf`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(renderReportHtml(report.data), { waitUntil: "networkidle" });
    await page.pdf({ path: file, format: "Letter", printBackground: true });
  } finally {
    await browser.close();
  }
  await controlQuery("UPDATE reports SET pdf_path = $2 WHERE id = $1", [reportId, file]);
  return file;
}

/**
 * Email the report: the big number in the subject line (the 60-second rule
 * applies to the inbox too), the summary in the body, the portal as the
 * durable copy. Marks sent_at — which freezes the report forever.
 */
export async function sendReport(reportId: string, actor: string): Promise<{ delivered: string; to: string } | { skipped: string }> {
  const report = await controlOne<{
    id: string;
    tenant_id: string;
    data: ReportData;
    sent_at: string | null;
    slug: string;
    owner_email: string | null;
  }>(
    `SELECT r.id, r.tenant_id, r.data, r.sent_at, t.slug, t.owner_email
       FROM reports r JOIN tenants t ON t.id = r.tenant_id WHERE r.id = $1`,
    [reportId]
  );
  if (!report) throw new Error("sendReport: no such report");
  if (report.sent_at) return { skipped: "already sent — reports send once" };
  if (report.data.kind === "sample") return { skipped: "sample reports are a sales artifact, never emailed to a client" };
  if (!report.owner_email) return { skipped: "tenant has no owner_email on file" };

  const d = report.data;
  const apex = process.env.PLATFORM_APEX ?? "localhost:3000";
  const portalUrl = `http://${report.slug}.${apex}/portal/reports`;
  const isExit = d.kind === "exit";
  const lines = [
    `${d.contacts.total} ${d.contacts.total === 1 ? "person" : "people"} tried to contact ${d.business_name} ${isExit ? "through your site while it ran with us" : `in ${d.period.label}`}:`,
    "",
    `  • ${d.contacts.by_type.call_tap} tapped your phone number`,
    `  • ${d.contacts.by_type.form_submit} sent a quote request`,
    `  • ${d.contacts.by_type.map_tap} looked up directions`,
    "",
    d.trend.prev_total !== null && !isExit
      ? `Last month: ${d.trend.prev_total}. ${d.contacts.total >= d.trend.prev_total ? "" : "Down — the full report says what we know and what changes."}`
      : "",
    "",
    `The full report is in your portal: ${portalUrl}`,
    "",
    `— Curbside Sites`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "");
  const result = await sendPlatformEmail({
    to: report.owner_email,
    subject: isExit
      ? `${d.business_name} — your final report and full export`
      : `${d.business_name}: ${d.contacts.total} people tried to reach you in ${d.period.label}`,
    text: lines.join("\n"),
  });
  await controlQuery("UPDATE reports SET sent_at = now(), sent_to = $2 WHERE id = $1", [
    reportId,
    report.owner_email,
  ]);
  await audit(actor, report.tenant_id, "report.sent", { kind: d.kind, period: d.period.key, delivered: result.delivered });
  return { delivered: result.delivered, to: report.owner_email };
}

/**
 * The exit report (D20): the same artifact, numbers ending. Period = first of
 * the tenant's first month through today. Called by offboarding.
 */
export async function generateExitReport(tenantId: string, actor: string): Promise<StoredReport> {
  const tenant = await controlOne<{ created_at: string }>(
    "SELECT created_at FROM tenants WHERE id = $1",
    [tenantId]
  );
  if (!tenant) throw new Error("generateExitReport: unknown tenant");
  const created = new Date(tenant.created_at);
  const start = monthPeriod(created.getUTCFullYear(), created.getUTCMonth() + 1);
  const now = new Date();
  const period = {
    ...start,
    end: tzMidnight(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate() + 1),
    label: "Your full run",
  };
  return generateReport(tenantId, period, "exit", actor);
}
