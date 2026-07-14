/**
 * Domain provisioning (Part 2.5, D8, D15): create the Custom Hostname via
 * API, send REGISTRAR-SPECIFIC instructions, poll verification, notify both
 * sides, chase automatically. Clients are slow at this — the chase is a job,
 * not a memory.
 */
import { customHostnames } from "@/lib/adapters/cloudflare";
import { audit, controlOne, controlQuery, revalidateTenant } from "@/lib/control/db";
import { notifyStaff, sendPlatformEmail } from "@/lib/control/notify";

const CHASE_AFTER_DAYS = 3;

// ---------------------------------------------------------------------------
// Registrar-specific instructions (D8: they own the credentials; we send
// steps for THEIR registrar, not generic advice)
// ---------------------------------------------------------------------------

type DnsTarget = { type: string; name: string; value: string };

const REGISTRAR_PATHS: Record<string, string[]> = {
  GoDaddy: [
    "Sign in at godaddy.com and open My Products.",
    "Find your domain and click DNS (or 'Manage DNS').",
    "In the DNS Records table, add the records listed below (Add → pick the Type, paste Name and Value).",
    "GoDaddy pre-fills your domain in the Name field — for the record named exactly your domain, enter '@'.",
  ],
  Namecheap: [
    "Sign in at namecheap.com → Domain List → Manage next to your domain.",
    "Open the Advanced DNS tab.",
    "Add each record listed below with 'Add New Record'. Use '@' for the bare domain, and paste hostnames without your domain suffix (Namecheap appends it).",
  ],
  "Squarespace Domains (ex-Google)": [
    "Sign in at account.squarespace.com → Domains → your domain.",
    "Open DNS settings → DNS records.",
    "Add each record listed below with 'Add record'.",
  ],
  Cloudflare: [
    "Sign in at dash.cloudflare.com and select your domain.",
    "Open DNS → Records.",
    "Add each record listed below. IMPORTANT: set the cloud icon to 'DNS only' (gray) for the verification records.",
  ],
  IONOS: [
    "Sign in at ionos.com → Domains & SSL → your domain.",
    "Open the DNS tab.",
    "Add each record listed below with 'Add record'.",
  ],
  "Network Solutions": [
    "Sign in at networksolutions.com → Account Manager → My Domain Names.",
    "Select the domain → Manage → Change Where Domain Points → Advanced DNS.",
    "Add each record listed below.",
  ],
};

export function registrarInstructions(
  registrar: string | null,
  hostname: string,
  targets: DnsTarget[]
): string {
  const steps =
    REGISTRAR_PATHS[registrar ?? ""] ??
    [
      "Sign in wherever you registered the domain (we have it as: " + (registrar ?? "unknown") + ").",
      "Find the DNS settings (sometimes called DNS records, zone editor, or name server settings).",
      "Add the records listed below.",
    ];
  return [
    `Connecting ${hostname} to your new site — takes about 5 minutes:`,
    "",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Records to add:",
    ...targets.map((t) => `  • Type: ${t.type}   Name: ${t.name}   Value: ${t.value}`),
    "",
    "That's everything. We check automatically every few minutes and will email you the moment it connects — usually under an hour, occasionally up to a day.",
    "We never need your registrar password, and the domain stays yours, always.",
    "",
    "Stuck? Reply to this email and we'll get on a screen share.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Provision / poll / chase / release
// ---------------------------------------------------------------------------

export async function provisionDomain(tenantId: string, hostname: string, actor: string): Promise<void> {
  const provider = await customHostnames();
  const tenant = await controlOne<{ slug: string; owner_email: string | null; business_name: string }>(
    "SELECT slug, owner_email, business_name FROM tenants WHERE id = $1",
    [tenantId]
  );
  if (!tenant) throw new Error("provisionDomain: unknown tenant");

  const ch = await provider.create(hostname);
  const row = await controlOne<{ registrar: string | null }>(
    `INSERT INTO domains (tenant_id, hostname, is_primary, verification_status, cf_hostname_id, instructions_sent_at)
     VALUES ($1, $2, true, 'pending', $3, now())
     ON CONFLICT (hostname) DO UPDATE
       SET cf_hostname_id = $3, verification_status = 'pending', instructions_sent_at = now(),
           released_at = NULL, verified_at = NULL
     RETURNING registrar`,
    [tenantId, hostname.toLowerCase(), ch.id]
  );

  if (tenant.owner_email) {
    await sendPlatformEmail({
      to: tenant.owner_email,
      subject: `Connect ${hostname} to your new site (5 minutes)`,
      text: registrarInstructions(row?.registrar ?? null, hostname, ch.dns_targets),
    });
  }
  await audit(actor, tenantId, "domain.provisioned", { hostname, cf_id: ch.id, mode: provider.mode });
}

/** 2.5: flip draft → live only when the brand gate has passed AND a domain verified (or staff forces). */
export async function maybeGoLive(tenantId: string, actor: string, opts: { force?: boolean } = {}): Promise<
  { went_live: true } | { went_live: false; blocked_on: string }
> {
  const tenant = await controlOne<{ slug: string; status: string }>(
    "SELECT slug, status FROM tenants WHERE id = $1",
    [tenantId]
  );
  if (!tenant) return { went_live: false, blocked_on: "unknown tenant" };
  if (tenant.status !== "draft") return { went_live: false, blocked_on: `status is '${tenant.status}', not draft` };

  const proposal = await controlOne<{ status: string }>(
    "SELECT status FROM brand_proposals WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
    [tenantId]
  );
  if (proposal?.status !== "approved") {
    return { went_live: false, blocked_on: "brand gate: latest proposal is not approved (2.3)" };
  }

  if (!opts.force) {
    const verified = await controlOne(
      "SELECT 1 FROM domains WHERE tenant_id = $1 AND verification_status = 'verified'",
      [tenantId]
    );
    if (!verified) return { went_live: false, blocked_on: "no verified domain (staff can force platform-subdomain-only go-live)" };
  }

  await controlQuery("UPDATE tenants SET status = 'live', updated_at = now() WHERE id = $1", [tenantId]);
  await revalidateTenant(tenant.slug);
  await audit(actor, tenantId, "tenant.went_live", { forced: !!opts.force });
  await notifyStaff({
    tenantId,
    kind: "went_live",
    severity: "info",
    message: `${tenant.slug} is LIVE`,
  });
  return { went_live: true };
}

/** The polling job: pending hostnames → check → verified + notify both sides. */
export async function checkPendingDomains(): Promise<{ checked: number; verified: number }> {
  const provider = await customHostnames();
  const pending = await controlQuery<{
    id: string; tenant_id: string; hostname: string; cf_hostname_id: string | null;
    slug: string; owner_email: string | null; business_name: string;
  }>(
    `SELECT d.id, d.tenant_id, d.hostname, d.cf_hostname_id, t.slug, t.owner_email, t.business_name
       FROM domains d JOIN tenants t ON t.id = d.tenant_id
      WHERE d.verification_status = 'pending' AND d.cf_hostname_id IS NOT NULL`
  );
  let verified = 0;
  for (const d of pending) {
    try {
      const status = await provider.status(d.cf_hostname_id!, d.hostname);
      if (status.status === "active") {
        await controlQuery(
          "UPDATE domains SET verification_status = 'verified', verified_at = now() WHERE id = $1",
          [d.id]
        );
        verified++;
        if (d.owner_email) {
          await sendPlatformEmail({
            to: d.owner_email,
            subject: `${d.hostname} is connected ✓`,
            text: `${d.hostname} now points at your new site. If your site was waiting on this, it goes live now — we'll confirm shortly.\n\n— Curbside Sites`,
          });
        }
        await notifyStaff({
          tenantId: d.tenant_id,
          kind: "domain_verified",
          severity: "info",
          message: `${d.hostname} verified for ${d.slug}`,
        });
        await maybeGoLive(d.tenant_id, "system");
      } else if (status.status === "failed") {
        await notifyStaff({
          tenantId: d.tenant_id,
          kind: "domain_failed",
          severity: "warn",
          message: `${d.hostname} failed verification`,
          detail: { errors: status.errors },
        });
      }
    } catch (e) {
      console.error(`[domains] check failed for ${d.hostname}:`, e instanceof Error ? e.message : e);
    }
  }
  return { checked: pending.length, verified };
}

/** Chase automatically, not manually (2.5). Every N days until it lands. */
export async function chaseStalledDomains(): Promise<number> {
  const stalled = await controlQuery<{
    id: string; tenant_id: string; hostname: string; registrar: string | null;
    owner_email: string | null; slug: string;
  }>(
    `SELECT d.id, d.tenant_id, d.hostname, d.registrar, t.owner_email, t.slug
       FROM domains d JOIN tenants t ON t.id = d.tenant_id
      WHERE d.verification_status = 'pending'
        AND d.instructions_sent_at < now() - interval '${CHASE_AFTER_DAYS} days'
        AND (d.last_chased_at IS NULL OR d.last_chased_at < now() - interval '${CHASE_AFTER_DAYS} days')`
  );
  for (const d of stalled) {
    if (d.owner_email) {
      await sendPlatformEmail({
        to: d.owner_email,
        subject: `Quick nudge: ${d.hostname} isn't connected yet`,
        text: [
          `Your new site is finished and waiting — it just needs the DNS records we sent over for ${d.hostname}.`,
          "It's about 5 minutes at " + (d.registrar ?? "your registrar") + ". Want us to walk you through it on a call? Just reply with a good time.",
          "",
          "— Curbside Sites",
        ].join("\n"),
      });
    }
    await controlQuery("UPDATE domains SET last_chased_at = now() WHERE id = $1", [d.id]);
    await notifyStaff({
      tenantId: d.tenant_id,
      kind: "domain_stuck",
      severity: "warn",
      message: `${d.hostname} (${d.slug}) still pending after ${CHASE_AFTER_DAYS}+ days — client chased automatically`,
    });
  }
  return stalled.length;
}

/** Offboarding step 3 (Part 9): remove the hostname, hand back clean instructions. */
export async function releaseDomains(tenantId: string, actor: string): Promise<string[]> {
  const provider = await customHostnames();
  const rows = await controlQuery<{ id: string; hostname: string; cf_hostname_id: string | null }>(
    "SELECT id, hostname, cf_hostname_id FROM domains WHERE tenant_id = $1 AND verification_status <> 'released'",
    [tenantId]
  );
  const released: string[] = [];
  for (const d of rows) {
    if (d.cf_hostname_id) {
      try {
        await provider.remove(d.cf_hostname_id);
      } catch (e) {
        console.error(`[domains] CF removal failed for ${d.hostname} (continuing):`, e);
      }
    }
    await controlQuery(
      `UPDATE domains SET verification_status = 'released', released_at = now(), cf_hostname_id = NULL WHERE id = $1`,
      [d.id]
    );
    released.push(d.hostname);
  }
  await audit(actor, tenantId, "domains.released", { hostnames: released });
  return released;
}
