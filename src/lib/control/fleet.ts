/**
 * The fleet dashboard's data (Part 6): one row per tenant, sorted by what's
 * on fire. Part 0 is honest that this table is a guess — keep the signals
 * cheap to change.
 */
import { controlQuery } from "@/lib/control/db";

export interface FleetRow {
  id: string;
  slug: string;
  business_name: string;
  status: "draft" | "live" | "suspended";
  plan_tier: string;
  preview_token: string;
  // signals
  leads_7d: number;
  leads_30d: number;
  open_alerts: { kind: string; severity: string }[];
  integrations_live: number;
  integrations_total: number;
  integration_errors_7d: number;
  last_integration_error: string | null;
  deliverability: boolean | null; // latest check; null = unknown/skipped
  form_check_ok: boolean | null;
  billing_status: string;
  mrr_cents: number;
  last_content_update: string | null;
  open_change_requests: number;
  pending_actions: number;
  brand_gate: "approved" | "proposed" | "rejected" | "none";
  domains: { hostname: string; verification_status: string }[];
  secret_expiry_warnings: number;
  fire_score: number;
}

export async function fleetOverview(): Promise<FleetRow[]> {
  const [tenants, leads, alerts, integrations, checks, billing, content, crs, actions, proposals, domains] =
    await Promise.all([
      controlQuery(
        "SELECT id, slug, business_name, status, plan_tier, preview_token FROM tenants ORDER BY slug"
      ),
      controlQuery(
        `SELECT tenant_id,
                count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS d7,
                count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS d30
           FROM leads WHERE is_demo = false AND source <> 'synthetic' GROUP BY tenant_id`
      ),
      controlQuery(
        "SELECT tenant_id, kind, severity FROM alerts WHERE resolved_at IS NULL"
      ),
      controlQuery(
        `SELECT tenant_id,
                count(*)::int AS total,
                count(*) FILTER (WHERE mode = 'live')::int AS live,
                count(*) FILTER (WHERE last_error_at > now() - interval '7 days')::int AS errors_7d,
                max(last_error_at) AS last_error,
                count(*) FILTER (WHERE secret_expires_at IS NOT NULL AND secret_expires_at < now() + interval '30 days')::int AS expiring
           FROM integrations GROUP BY tenant_id`
      ),
      controlQuery(
        `SELECT DISTINCT ON (tenant_id, kind) tenant_id, kind, ok
           FROM synthetic_checks ORDER BY tenant_id, kind, created_at DESC`
      ),
      controlQuery("SELECT tenant_id, status, mrr_cents FROM billing"),
      controlQuery(
        "SELECT tenant_id, max(updated_at) AS last_update FROM content GROUP BY tenant_id"
      ),
      controlQuery(
        `SELECT tenant_id, count(*)::int AS n FROM change_requests
          WHERE resolved_at IS NULL AND (status = 'escalated' OR urgent) GROUP BY tenant_id`
      ),
      controlQuery(
        "SELECT tenant_id, count(*)::int AS n FROM pending_actions WHERE status = 'pending' GROUP BY tenant_id"
      ),
      controlQuery(
        `SELECT DISTINCT ON (tenant_id) tenant_id, status FROM brand_proposals ORDER BY tenant_id, created_at DESC`
      ),
      controlQuery("SELECT tenant_id, hostname, verification_status FROM domains ORDER BY is_primary DESC"),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = <T extends Record<string, any>>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const key = String(r.tenant_id);
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  };
  const leadsBy = by(leads);
  const alertsBy = by(alerts);
  const intBy = by(integrations);
  const checksBy = by(checks);
  const billingBy = by(billing);
  const contentBy = by(content);
  const crBy = by(crs);
  const actionsBy = by(actions);
  const proposalBy = by(proposals);
  const domainsBy = by(domains);

  const rows: FleetRow[] = tenants.map((t) => {
    const l = leadsBy.get(t.id)?.[0];
    const a = alertsBy.get(t.id) ?? [];
    const i = intBy.get(t.id)?.[0];
    const c = checksBy.get(t.id) ?? [];
    const b = billingBy.get(t.id)?.[0];
    const deliverability = c.find((x) => x.kind === "email_deliverability")?.ok ?? null;
    const formCheck = c.find((x) => x.kind === "form_delivery")?.ok ?? null;

    const row: FleetRow = {
      id: t.id,
      slug: t.slug,
      business_name: t.business_name,
      status: t.status,
      plan_tier: t.plan_tier,
      preview_token: t.preview_token,
      leads_7d: l?.d7 ?? 0,
      leads_30d: l?.d30 ?? 0,
      open_alerts: a.map((x) => ({ kind: x.kind, severity: x.severity })),
      integrations_live: i?.live ?? 0,
      integrations_total: i?.total ?? 0,
      integration_errors_7d: i?.errors_7d ?? 0,
      last_integration_error: i?.last_error ?? null,
      deliverability,
      form_check_ok: formCheck,
      billing_status: b?.status ?? "none",
      mrr_cents: b?.mrr_cents ?? 0,
      last_content_update: contentBy.get(t.id)?.[0]?.last_update ?? null,
      open_change_requests: crBy.get(t.id)?.[0]?.n ?? 0,
      pending_actions: actionsBy.get(t.id)?.[0]?.n ?? 0,
      brand_gate: (proposalBy.get(t.id)?.[0]?.status as FleetRow["brand_gate"]) ?? "none",
      domains: (domainsBy.get(t.id) ?? []).map((d) => ({
        hostname: d.hostname,
        verification_status: d.verification_status,
      })),
      secret_expiry_warnings: i?.expiring ?? 0,
      fire_score: 0,
    };
    // Sorted by what's on fire.
    row.fire_score =
      row.open_alerts.filter((x) => x.severity === "critical").length * 100 +
      row.open_alerts.filter((x) => x.severity === "warn").length * 15 +
      row.pending_actions * 50 +
      (row.form_check_ok === false ? 80 : 0) +
      (row.deliverability === false ? 60 : 0) +
      (row.billing_status === "past_due" || row.billing_status === "unpaid" ? 30 : 0) +
      row.integration_errors_7d * 10 +
      row.secret_expiry_warnings * 10 +
      (row.status === "draft" && row.brand_gate === "proposed" ? 25 : 0) +
      row.open_change_requests * 8;
    return row;
  });

  return rows.sort((a, b) => b.fire_score - a.fire_score || a.slug.localeCompare(b.slug));
}
