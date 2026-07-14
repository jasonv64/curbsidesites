/**
 * Scheduled jobs (Parts 2.5, 4, 5): the watching half of the control plane.
 * Every job is independent — one failing must not stop the rest — and every
 * finding lands as an alerts row so the dashboard, not someone's memory, is
 * the source of truth.
 *
 * Runner: POST /api/jobs/run (staff token or CRON_TOKEN) — locally via
 * `npm run jobs`, in production via a scheduled trigger (Session 4).
 */
import { resolveTxt } from "node:dns/promises";
import { withTenant } from "@/lib/db";
import { sendTenantEmail } from "@/lib/adapters/email";
import type { TenantBundle } from "@/lib/tenant";
import { controlOne, controlQuery } from "@/lib/control/db";
import { notifyStaff } from "@/lib/control/notify";
import { checkPendingDomains, chaseStalledDomains } from "@/lib/control/domains";
import { runDunning } from "@/lib/control/billing";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Don't re-fire an alert that's already open for this tenant+kind. */
async function alertOnce(opts: {
  tenantId: string | null;
  kind: string;
  severity: "info" | "warn" | "critical";
  message: string;
  detail?: Record<string, unknown>;
}): Promise<boolean> {
  const open = await controlOne(
    `SELECT 1 FROM alerts WHERE kind = $1 AND resolved_at IS NULL
        AND tenant_id IS NOT DISTINCT FROM $2::uuid`,
    [opts.kind, opts.tenantId]
  );
  if (open) return false;
  await notifyStaff(opts);
  return true;
}

/**
 * A minimal bundle for adapter calls from job context: the email adapter only
 * reads tenant identity + integrations. Everything else is inert.
 */
async function minimalBundle(tenant: {
  id: string; slug: string; business_name: string; status: string; plan_tier: string;
  features: Record<string, boolean>; owner_email: string | null; preview_token: string;
}): Promise<TenantBundle> {
  const integrations = await withTenant(tenant.id, (db) =>
    db.query("SELECT key, mode, config, kv_secret_ref FROM integrations")
  );
  return {
    tenant: tenant as TenantBundle["tenant"],
    profile: null,
    brand: null,
    services: [],
    sections: [],
    images: [],
    integrations: integrations as TenantBundle["integrations"],
  };
}

// ---------------------------------------------------------------------------
// Part 5: the alarm that matters most — a form that stopped delivering
// ---------------------------------------------------------------------------

/**
 * Alert on ZERO submissions in 14 days on any tenant that previously had a
 * baseline. Demo rows and synthetic probes never count in either direction.
 */
export async function zeroSubmissionScan(): Promise<{ scanned: number; fired: number }> {
  const rows = await controlQuery<{ id: string; slug: string; last_lead: string }>(
    `SELECT t.id, t.slug, max(l.created_at) AS last_lead
       FROM tenants t JOIN leads l ON l.tenant_id = t.id
      WHERE t.status = 'live' AND l.is_demo = false AND l.source <> 'synthetic'
      GROUP BY t.id, t.slug
     HAVING max(l.created_at) < now() - interval '14 days'`
  );
  let fired = 0;
  for (const r of rows) {
    const isNew = await alertOnce({
      tenantId: r.id,
      kind: "zero_form_submissions",
      severity: "critical",
      message: `${r.slug}: NO form submissions in 14+ days (last: ${new Date(r.last_lead).toISOString().slice(0, 10)}). The perfect silent failure — investigate before they churn.`,
      detail: { last_lead_at: r.last_lead },
    });
    if (isNew) fired++;
  }
  return { scanned: rows.length, fired };
}

/**
 * Synthetic end-to-end submission: post a lead, confirm it lands in the RIGHT
 * tenant, confirm the notification email is delivered (live mode) or
 * console-delivered (demo), delete it, log the result.
 */
export async function syntheticFormChecks(): Promise<{ ran: number; failed: number }> {
  const tenants = await controlQuery<{
    id: string; slug: string; business_name: string; status: string; plan_tier: string;
    features: Record<string, boolean>; owner_email: string | null; preview_token: string;
  }>(
    `SELECT id, slug, business_name, status, plan_tier, features, owner_email, preview_token
       FROM tenants WHERE status = 'live' ORDER BY slug`
  );
  let failed = 0;
  for (const t of tenants) {
    const detail: Record<string, unknown> = {};
    let ok = false;
    try {
      // 1. Post a lead through the app's own tenant-scoped write path.
      const inserted = await withTenant(t.id, (db) =>
        db.one(
          `INSERT INTO leads (tenant_id, name, contact, message, source)
           VALUES ($1, 'Synthetic Probe', '{"email":"probe@curbsidesites.com"}', 'Scheduled end-to-end form check (auto-deleted).', 'synthetic')
           RETURNING id`,
          [t.id]
        )
      );
      if (!inserted) throw new Error("insert returned nothing");

      // 2. Confirm it landed in the RIGHT tenant (cross-check via control).
      const landed = await controlOne<{ tenant_id: string }>(
        "SELECT tenant_id FROM leads WHERE id = $1",
        [inserted.id]
      );
      if (landed?.tenant_id !== t.id) throw new Error(`lead landed in wrong tenant: ${landed?.tenant_id}`);
      detail.lead_landed = true;

      // 3. Confirm the owner notification path delivers.
      if (t.owner_email) {
        const bundle = await minimalBundle(t);
        const result = await sendTenantEmail(bundle, {
          to: t.owner_email,
          subject: `[synthetic check] ${t.business_name} lead notifications are working`,
          text: "Scheduled probe confirming lead notifications deliver. No action needed.",
        });
        detail.email = result;
      } else {
        detail.email = "no owner_email — skipped";
      }

      // 4. Delete the probe.
      await withTenant(t.id, (db) => db.query("DELETE FROM leads WHERE id = $1", [inserted.id]));
      ok = true;
    } catch (e) {
      detail.error = e instanceof Error ? e.message : String(e);
      failed++;
      await alertOnce({
        tenantId: t.id,
        kind: "form_delivery_broken",
        severity: "critical",
        message: `${t.slug}: synthetic form check FAILED — leads may be going nowhere`,
        detail,
      });
    }
    await controlQuery(
      "INSERT INTO synthetic_checks (tenant_id, kind, ok, detail) VALUES ($1, 'form_delivery', $2, $3)",
      [t.id, ok, JSON.stringify(detail)]
    );
  }
  return { ran: tenants.length, failed };
}

/**
 * Deliverability per custom domain: SPF + DMARC + (Resend) DKIM TXT records.
 * Local/test domains record ok=NULL (skipped) rather than lying either way.
 */
export async function deliverabilityChecks(): Promise<{ ran: number; failing: number }> {
  const domains = await controlQuery<{ tenant_id: string; hostname: string; slug: string }>(
    `SELECT d.tenant_id, d.hostname, t.slug
       FROM domains d JOIN tenants t ON t.id = d.tenant_id
      WHERE t.status = 'live' AND d.verification_status = 'verified'`
  );
  let failing = 0;
  for (const d of domains) {
    if (d.hostname.endsWith(".test") || d.hostname.endsWith(".localhost")) {
      await controlQuery(
        `INSERT INTO synthetic_checks (tenant_id, kind, ok, detail)
         VALUES ($1, 'email_deliverability', NULL, '{"skipped":"local test domain — no public DNS"}')`,
        [d.tenant_id]
      );
      continue;
    }
    const detail: Record<string, unknown> = {};
    const lookup = async (name: string, contains: string) => {
      try {
        const txt = (await resolveTxt(name)).map((r) => r.join(""));
        return txt.some((v) => v.includes(contains));
      } catch {
        return false;
      }
    };
    detail.spf = await lookup(d.hostname, "v=spf1");
    detail.dmarc = await lookup(`_dmarc.${d.hostname}`, "v=DMARC1");
    detail.dkim = await lookup(`resend._domainkey.${d.hostname}`, "p=");
    const ok = Boolean(detail.spf && detail.dmarc && detail.dkim);
    if (!ok) {
      failing++;
      await alertOnce({
        tenantId: d.tenant_id,
        kind: "deliverability",
        severity: "critical",
        message: `${d.slug}: ${d.hostname} deliverability records incomplete — lead emails may be landing in spam`,
        detail,
      });
    }
    await controlQuery(
      "INSERT INTO synthetic_checks (tenant_id, kind, ok, detail) VALUES ($1, 'email_deliverability', $2, $3)",
      [d.tenant_id, ok, JSON.stringify(detail)]
    );
  }
  return { ran: domains.length, failing };
}

// ---------------------------------------------------------------------------
// Part 3: secret expiry — warn BEFORE the key dies
// ---------------------------------------------------------------------------

export async function secretExpiryScan(): Promise<{ warned: number }> {
  const rows = await controlQuery<{
    tenant_id: string; key: string; kv_secret_ref: string; secret_expires_at: string; slug: string;
  }>(
    `SELECT i.tenant_id, i.key, i.kv_secret_ref, i.secret_expires_at, t.slug
       FROM integrations i JOIN tenants t ON t.id = i.tenant_id
      WHERE i.secret_expires_at IS NOT NULL
        AND i.secret_expires_at < now() + interval '30 days'`
  );
  let warned = 0;
  for (const r of rows) {
    const expired = new Date(r.secret_expires_at).getTime() < Date.now();
    const isNew = await alertOnce({
      tenantId: r.tenant_id,
      kind: "secret_expiry",
      severity: expired ? "critical" : "warn",
      message: `${r.slug}: secret '${r.kv_secret_ref}' (${r.key}) ${expired ? "has EXPIRED" : `expires ${new Date(r.secret_expires_at).toISOString().slice(0, 10)}`} — rotate it`,
      detail: { integration: r.key, expires_at: r.secret_expires_at },
    });
    if (isNew) warned++;
  }
  return { warned };
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export async function runAllJobs(): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { started_at: new Date().toISOString() };
  const jobs: [string, () => Promise<unknown>][] = [
    ["domains_check", checkPendingDomains],
    ["domains_chase", chaseStalledDomains],
    ["dunning", () => runDunning()],
    ["zero_submissions", zeroSubmissionScan],
    ["synthetic_forms", syntheticFormChecks],
    ["deliverability", deliverabilityChecks],
    ["secret_expiry", secretExpiryScan],
  ];
  for (const [name, job] of jobs) {
    try {
      summary[name] = await job();
    } catch (e) {
      summary[name] = { error: e instanceof Error ? e.message : String(e) };
      console.error(`[jobs] ${name} failed:`, e);
    }
  }
  summary.finished_at = new Date().toISOString();
  return summary;
}
