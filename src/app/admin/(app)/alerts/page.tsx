import Link from "next/link";
import { controlQuery } from "@/lib/control/db";
import { resolveAlertAction } from "../actions";

export const dynamic = "force-dynamic";

/** What's on fire, in one list (Parts 5 & 6). Jobs write these; you resolve them. */
export default async function AlertsPage() {
  const alerts = await controlQuery<{
    id: string; kind: string; severity: string; message: string; created_at: string; slug: string | null;
  }>(
    `SELECT a.id, a.kind, a.severity, a.message, a.created_at, t.slug
       FROM alerts a LEFT JOIN tenants t ON t.id = a.tenant_id
      WHERE a.resolved_at IS NULL
      ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, a.created_at DESC`
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">Open alerts</h1>
      {alerts.length === 0 && <p className="text-sm text-ink-muted">Nothing on fire.</p>}
      <ul className="flex flex-col gap-2">
        {alerts.map((a) => (
          <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm ${a.severity === "critical" ? "border-accent" : "border-edge"}`}>
            <div>
              <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-bold uppercase ${a.severity === "critical" ? "bg-accent text-on-accent" : "bg-surface-raised"}`}>
                {a.severity}
              </span>
              <span className="font-mono text-xs text-ink-muted">{a.kind}</span>
              {a.slug && (
                <> · <Link href={`/tenants/${a.slug}`} className="font-semibold text-accent underline">{a.slug}</Link></>
              )}
              <p className="mt-1">{a.message}</p>
              <p className="text-xs text-ink-muted">{new Date(a.created_at).toLocaleString()}</p>
            </div>
            <form action={resolveAlertAction}>
              <input type="hidden" name="alert_id" value={a.id} />
              <button type="submit" className="rounded border border-edge px-3 py-1.5 font-semibold hover:text-accent">
                Resolve
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
