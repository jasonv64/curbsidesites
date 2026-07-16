/**
 * Manual report run (GROWTH-PLANE Part 5). The scheduler does this monthly on
 * its own; this script is for previews, samples, catch-ups, and reading the
 * artifact before a prospect does.
 *
 * Usage:
 *   npm run report -- <tenant-slug>                    # last complete month, monthly
 *   npm run report -- <tenant-slug> 2026-06            # explicit period
 *   npm run report -- <tenant-slug> --sample           # demo-data sample, stamped
 *   npm run report -- <tenant-slug> --send             # email it (marks immutable)
 */
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("-") && !/^\d{4}-\d{2}$/.test(a));
  const periodArg = args.find((a) => /^\d{4}-\d{2}$/.test(a));
  const kind = args.includes("--sample") ? ("sample" as const) : ("monthly" as const);
  const send = args.includes("--send");
  if (!slug) {
    console.error("usage: npm run report -- <tenant-slug> [YYYY-MM] [--sample] [--send]");
    process.exit(1);
  }

  const { controlOne } = await import("../src/lib/control/db");
  const { lastCompleteMonth, parsePeriodKey } = await import("../src/lib/growth/period");
  const { generateReport, renderReportPdf, sendReport } = await import("../src/lib/growth/report-run");
  const { renderReportHtml } = await import("../src/lib/growth/report-html");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const tenant = await controlOne<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [slug]);
  if (!tenant) throw new Error(`no tenant with slug '${slug}'`);
  const period = periodArg ? parsePeriodKey(periodArg) : lastCompleteMonth();
  if (!period) throw new Error(`bad period '${periodArg}' — use YYYY-MM`);

  const report = await generateReport(tenant.id, period, kind, "cli");
  const d = report.data;
  console.log(`\n${d.business_name} — ${d.period.label} (${kind})`);
  console.log(`  contacts: ${d.contacts.total} (calls ${d.contacts.by_type.call_tap} · forms ${d.contacts.by_type.form_submit} · directions ${d.contacts.by_type.map_tap})`);
  console.log(`  vs prev month: ${d.trend.prev_total ?? "no data"} · reviews: ${d.reviews.available ? `${d.reviews.total_count} @ ${d.reviews.avg_rating}` : "not tracked"}`);
  console.log(`  search terms with movement shown: ${d.search.terms.length}/${d.search.tracked_count}`);
  if (d.data_gaps.length) console.log(`  gaps stated: ${d.data_gaps.length}`);

  const dir = join(process.cwd(), ".data", "reports", slug);
  await mkdir(dir, { recursive: true });
  const htmlPath = join(dir, `${d.period.key}-${kind}.html`);
  await writeFile(htmlPath, renderReportHtml(d), "utf8");
  const pdf = await renderReportPdf(report.id).catch(() => null);
  console.log(`  html: ${htmlPath}`);
  console.log(`  pdf:  ${pdf ?? "skipped (playwright/chromium unavailable)"}`);

  if (send) {
    const result = await sendReport(report.id, "cli");
    console.log(`  send: ${JSON.stringify(result)}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
