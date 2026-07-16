/**
 * The growth-plane job dispatcher. `runAllJobs()` (control plane) calls this
 * on every jobs tick; only work whose staggered slot has arrived actually
 * runs. One tenant's failure backs off THAT tenant's job and touches nothing
 * else — the batch never dies in the middle (Part 2 / Part 10.4).
 */
import { alertOnce } from "@/lib/control/jobs";
import { lastCompleteMonth } from "./period";
import { generateReport, renderReportPdf, sendReport } from "./report-run";
import { checkNapDrift } from "./nap-drift";
import { fetchTenantReviews, type ReviewFetchers } from "./reviews-job";
import { refreshRanks } from "./rank-tracking";
import { runContentCalendar } from "./content-calendar";
import { runSolicitation, solicitationEnabled } from "./solicitation";
import { dueJobs, ensureSchedules, recordRun, type DueJob, type RunStatus } from "./scheduler";
import { controlOne } from "@/lib/control/db";

const rankEnabled = (t: DueJob) =>
  t.plan_tier === "curb_plus" || t.plan_tier === "curb_pro" || t.features?.rank_tracking === true;

export async function runGrowthJobs(opts?: {
  now?: Date;
  reviewFetchers?: ReviewFetchers; // injectable for the quota-failure test
}): Promise<Record<string, unknown>> {
  const now = opts?.now ?? new Date();
  const created = await ensureSchedules(now);
  const due = await dueJobs(now);
  const summary: Record<string, unknown> = { schedules_created: created, due: due.length };
  const counts: Record<string, Record<string, number>> = {};

  for (const job of due) {
    let status: RunStatus = "ok";
    let detail: Record<string, unknown> = {};
    try {
      switch (job.job) {
        case "reviews_fetch": {
          ({ status, detail } = await fetchTenantReviews(job, opts?.reviewFetchers));
          break;
        }
        case "rank_tracking": {
          if (!rankEnabled(job)) {
            status = "skipped";
            detail = { reason: `rank tracking is Curb+ and up; '${job.slug}' is ${job.plan_tier}` };
          } else {
            ({ status, detail } = await refreshRanks(job));
          }
          break;
        }
        case "nap_drift": {
          ({ status, detail } = await checkNapDrift(job));
          break;
        }
        case "review_solicitation": {
          if (!solicitationEnabled(job.plan_tier, job.features)) {
            status = "skipped";
            detail = { reason: `solicitation is Curb+ and up; '${job.slug}' is ${job.plan_tier}` };
          } else if (job.status !== "live") {
            status = "skipped";
            detail = { reason: "tenant not live" };
          } else {
            ({ status, detail } = await runSolicitation(job));
          }
          break;
        }
        case "content_calendar": {
          if (job.status !== "live") {
            status = "skipped";
            detail = { reason: "content calendar starts at go-live; seeding covers drafts" };
          } else {
            ({ status, detail } = await runContentCalendar(job));
          }
          break;
        }
        case "monthly_report": {
          if (job.status !== "live") {
            status = "skipped";
            detail = { reason: "reports are for live tenants" };
          } else {
            detail = await monthlyReportJob(job, now);
          }
          break;
        }
      }
    } catch (e) {
      status = "failed";
      detail = { error: e instanceof Error ? e.message : String(e) };
      console.error(`[growth] ${job.job} failed for ${job.slug}:`, e);
      // Loud where it matters: consent refusals and half-configured
      // integrations are operator problems, not transient weather.
      const message = detail.error as string;
      const operatorError = /Consent|flagged LIVE|Refusing/i.test(message);
      if (operatorError || job.backoff_level >= 2) {
        await alertOnce({
          tenantId: job.tenant_id,
          kind: `growth_${job.job}`,
          severity: operatorError ? "critical" : "warn",
          message: `${job.slug}: growth job '${job.job}' ${operatorError ? "refused" : `failing repeatedly (${job.backoff_level + 1}x)`} — ${message.slice(0, 160)}`,
          detail,
        });
      }
    }
    await recordRun(job, status, detail, now);
    counts[job.job] ??= {};
    counts[job.job][status] = (counts[job.job][status] ?? 0) + 1;
  }
  summary.jobs = counts;
  return summary;
}

/**
 * Generate → PDF (best effort) → send, for the last complete month. The
 * UNIQUE(tenant,kind,period) row plus sent_at make this idempotent: a re-run
 * after a partial failure finishes the remaining steps, never double-sends.
 */
async function monthlyReportJob(job: DueJob, now: Date): Promise<Record<string, unknown>> {
  const period = lastCompleteMonth(now);
  const existing = await controlOne<{ id: string; sent_at: string | null; pdf_path: string | null }>(
    "SELECT id, sent_at, pdf_path FROM reports WHERE tenant_id = $1 AND kind = 'monthly' AND period_start = $2",
    [job.tenant_id, period.start]
  );
  if (existing?.sent_at) return { report: "already sent", period: period.label };

  const report = existing ?? (await generateReport(job.tenant_id, period, "monthly", "growth-pipeline"));
  const pdf = existing?.pdf_path ?? (await renderReportPdf(report.id));
  const send = await sendReport(report.id, "growth-pipeline");
  return { period: period.label, pdf: pdf ?? "skipped (no chromium here — portal + email still serve)", send };
}
