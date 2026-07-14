import Link from "next/link";
import { fleetOverview } from "@/lib/control/fleet";
import { controlQuery } from "@/lib/control/db";
import { RunJobsButton } from "./run-jobs-button";

export const dynamic = "force-dynamic";

/**
 * The fleet dashboard (Part 6): one table, one row per tenant, sorted by
 * what's on fire. Part 0 says this page is a guess to be rewritten once four
 * real clients teach us what we actually look at — keep it disposable.
 */

function Dot({ state }: { state: "ok" | "bad" | "unknown" }) {
  const cls = state === "ok" ? "bg-brand" : state === "bad" ? "bg-accent" : "bg-edge";
  const label = state === "ok" ? "ok" : state === "bad" ? "failing" : "unknown";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

export default async function FleetPage() {
  const [fleet, openActions] = await Promise.all([
    fleetOverview(),
    controlQuery<{ n: number }>("SELECT count(*)::int AS n FROM pending_actions WHERE status = 'pending'"),
  ]);
  const totalMrr = fleet.reduce((sum, r) => sum + r.mrr_cents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Fleet</h1>
          <p className="text-sm text-ink-muted">
            {fleet.length} tenants · ${(totalMrr / 100).toLocaleString()} MRR ·{" "}
            {openActions[0]?.n ?? 0} pending human action{(openActions[0]?.n ?? 0) === 1 ? "" : "s"}
            {(openActions[0]?.n ?? 0) > 0 && (
              <> — <Link href="/queue" className="font-semibold text-accent underline">review the queue</Link></>
            )}
          </p>
        </div>
        <RunJobsButton />
      </div>

      <div className="overflow-x-auto rounded border border-edge">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-surface-raised text-left">
            <tr>
              <th className="p-2">Tenant</th>
              <th className="p-2">Status</th>
              <th className="p-2" title="Form submissions, last 7 / 30 days (Part 5)">Leads 7/30d</th>
              <th className="p-2" title="Latest synthetic form-delivery check">Form</th>
              <th className="p-2" title="SPF/DKIM/DMARC on the sending domain">Email</th>
              <th className="p-2">Integrations</th>
              <th className="p-2">Billing</th>
              <th className="p-2">MRR</th>
              <th className="p-2">Content</th>
              <th className="p-2">CRs</th>
              <th className="p-2">Alerts</th>
              <th className="p-2" title="Core Web Vitals need real-user monitoring — lands with cloud infra (Session 4)">CWV</th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((r) => (
              <tr key={r.id} className={`border-t border-edge ${r.fire_score >= 100 ? "bg-surface-raised" : ""}`}>
                <td className="p-2">
                  <Link href={`/tenants/${r.slug}`} className="font-semibold text-accent underline">
                    {r.slug}
                  </Link>
                  {r.fire_score >= 100 && <span className="ml-1" role="img" aria-label="on fire">🔥</span>}
                  <div className="text-xs text-ink-muted">
                    {r.domains.length
                      ? r.domains.map((d) => `${d.hostname} (${d.verification_status})`).join(", ")
                      : "platform subdomain only"}
                  </div>
                </td>
                <td className="p-2">
                  {r.status}
                  {r.status === "draft" && (
                    <div className="text-xs text-ink-muted">brand gate: {r.brand_gate}</div>
                  )}
                </td>
                <td className="p-2 tabular-nums">{r.leads_7d} / {r.leads_30d}</td>
                <td className="p-2"><Dot state={r.form_check_ok === null ? "unknown" : r.form_check_ok ? "ok" : "bad"} /></td>
                <td className="p-2"><Dot state={r.deliverability === null ? "unknown" : r.deliverability ? "ok" : "bad"} /></td>
                <td className="p-2">
                  {r.integrations_live}/{r.integrations_total} live
                  {r.integration_errors_7d > 0 && (
                    <div className="text-xs font-semibold text-accent">{r.integration_errors_7d} erroring</div>
                  )}
                  {r.secret_expiry_warnings > 0 && (
                    <div className="text-xs font-semibold text-accent">{r.secret_expiry_warnings} secret{r.secret_expiry_warnings > 1 ? "s" : ""} expiring</div>
                  )}
                </td>
                <td className="p-2">{r.billing_status}</td>
                <td className="p-2 tabular-nums">${(r.mrr_cents / 100).toLocaleString()}</td>
                <td className="p-2 text-xs">
                  {r.last_content_update ? new Date(r.last_content_update).toISOString().slice(0, 10) : "—"}
                </td>
                <td className="p-2 tabular-nums">{r.open_change_requests || "—"}</td>
                <td className="p-2 text-xs">
                  {r.open_alerts.length
                    ? r.open_alerts.map((a, i) => (
                        <div key={i} className={a.severity === "critical" ? "font-semibold text-accent" : ""}>
                          {a.kind}
                        </div>
                      ))
                    : "—"}
                </td>
                <td className="p-2 text-xs text-ink-muted" title="Real-user monitoring lands in Session 4">n/a (S4)</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">
        Uptime + failover events (D6) join this table when the static-failover health check goes
        cloud-side in Session 4 — the alerts column already carries <code>failover</code> events
        when they exist.
      </p>
    </div>
  );
}
