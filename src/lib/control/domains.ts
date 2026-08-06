/**
 * Domain provisioning (Part 2.5, D8, D15): create the Custom Hostname via
 * API, send REGISTRAR-SPECIFIC instructions, poll verification, notify both
 * sides, chase automatically. Clients are slow at this — the chase is a job,
 * not a memory.
 */
import { customHostnames } from "@/lib/adapters/cloudflare";
import { audit, controlOne, controlQuery, controlTx, revalidateTenant } from "@/lib/control/db";
import { notifyStaff, sendPlatformEmail } from "@/lib/control/notify";

const CHASE_AFTER_DAYS = 3;

// ---------------------------------------------------------------------------
// Hostname anatomy (D22). Deliberately small: our clients' domains are
// overwhelmingly .com/.net/.us; the two-level list covers the plausible
// stragglers without dragging in a full public-suffix database.
// ---------------------------------------------------------------------------

const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "com.au", "net.au", "org.au",
  "co.nz", "com.mx", "com.br",
]);

/** "www.dubdating.com" → "dubdating.com". Where SPF/DKIM/DMARC actually live. */
export function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const take = TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** A zone apex can never carry a CNAME (RFC 1034) — the D22 branch point. */
export function isApex(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  return h === registrableDomain(h);
}

/**
 * Registrars that CAN attach an apex to a CNAME-style target (flattening or
 * ALIAS). Everyone else — GoDaddy included, found the hard way provisioning
 * dubdating.com (D22) — needs the `www` custom hostname + an apex forward.
 */
const APEX_CAPABLE_NOTE: Record<string, string> = {
  Cloudflare: "Cloudflare flattens CNAME records at the bare domain automatically — add it like any other record.",
  Namecheap: "For the bare domain, pick the ALIAS record type instead of CNAME (Namecheap supports ALIAS at '@').",
};

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

  // D22: the instruction generator branches on apex-vs-subdomain, because a
  // CNAME cannot exist at a zone apex (RFC 1034) and most registrars don't
  // flatten. Emitting "CNAME <apex> → …" to a GoDaddy owner is an
  // instruction that cannot be followed — exactly what happened provisioning
  // dubdating.com.
  const apex = isApex(hostname);
  const apexNote = APEX_CAPABLE_NOTE[registrar ?? ""];
  const apexBlock: string[] = [];
  if (apex && apexNote) {
    apexBlock.push("", `Note for the bare-domain record: ${apexNote}`);
  } else if (apex) {
    // Unknown registrar (known non-flattening ones are refused upstream in
    // provisionDomain): give the honest caveat + the working alternative.
    apexBlock.push(
      "",
      "Heads up: some DNS providers won't accept a CNAME on the bare domain (no 'www').",
      `If yours refuses it, just reply to this email — we'll connect www.${hostname} instead,`,
      `and you'll add a domain forward from ${hostname} to https://www.${hostname}.`,
      "Make sure any forward points at the https:// address, marked permanent (301)."
    );
  }

  // The www custom hostname is the D22 shape for non-flattening registrars —
  // visitors still type the bare domain, so the apex forward is part of the
  // setup, and it MUST land on HTTPS (the dubdating.com forward hopped
  // through cleartext http).
  const rd = registrableDomain(hostname);
  const forwardBlock: string[] =
    !apex && hostname.toLowerCase().replace(/\.$/, "") === `www.${rd}`
      ? [
          "",
          `Then set up domain forwarding so the bare domain reaches the site:`,
          `  • Forward ${rd} → https://www.${rd}   (permanent / 301)`,
          `  • The destination must start with https:// — a plain http:// forward sends every visitor through an insecure hop.`,
        ]
      : [];

  return [
    `Connecting ${hostname} to your new site — takes about 5 minutes:`,
    "",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Records to add:",
    ...targets.map((t) => `  • Type: ${t.type}   Name: ${t.name}   Value: ${t.value}`),
    ...apexBlock,
    ...forwardBlock,
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
  const host = hostname.toLowerCase().replace(/\.$/, "");

  // D22(b): re-provisioning after releaseDomains used to create a fresh row
  // with registrar NULL, silently degrading the tailored instructions to the
  // generic "we have it as: unknown" fallback. Carry the registrar forward
  // from any prior row for this tenant (the intake row, or the released one).
  const prior = await controlOne<{ registrar: string | null }>(
    `SELECT registrar FROM domains
      WHERE tenant_id = $1 AND registrar IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId]
  );
  const knownRegistrar = prior?.registrar ?? null;

  // D22(a): an apex on a registrar without CNAME flattening is impossible to
  // instruct (RFC 1034). Refuse loudly with the working shape instead of
  // emailing the client steps they cannot follow.
  if (isApex(host) && knownRegistrar && REGISTRAR_PATHS[knownRegistrar] && !APEX_CAPABLE_NOTE[knownRegistrar]) {
    throw new Error(
      `${host} is a zone apex and ${knownRegistrar} can't point an apex at a CNAME (D22). ` +
        `Provision www.${host} instead; the client then forwards ${host} → https://www.${host} (permanent/301, HTTPS destination).`
    );
  }

  const ch = await provider.create(host);
  await controlTx(async (db) => {
    // The newest provisioned domain becomes primary; a tenant can never hold
    // two (partial unique index, migration 006) — demote first, atomically.
    await db.query("UPDATE domains SET is_primary = false WHERE tenant_id = $1 AND is_primary", [tenantId]);
    await db.query(
      `INSERT INTO domains (tenant_id, hostname, is_primary, registrar, verification_status, cf_hostname_id, instructions_sent_at)
       VALUES ($1, $2, true, $4, 'pending', $3, now())
       ON CONFLICT (hostname) DO UPDATE
         SET is_primary = true, cf_hostname_id = $3, verification_status = 'pending',
             instructions_sent_at = now(), released_at = NULL, verified_at = NULL,
             registrar = COALESCE(domains.registrar, $4)`,
      [tenantId, host, ch.id, knownRegistrar]
    );
  });

  if (tenant.owner_email) {
    await sendPlatformEmail({
      to: tenant.owner_email,
      subject: `Connect ${host} to your new site (5 minutes)`,
      text: registrarInstructions(knownRegistrar, host, ch.dns_targets),
    });
  }
  await audit(actor, tenantId, "domain.provisioned", { hostname: host, cf_id: ch.id, mode: provider.mode });
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
    // A released domain is never primary — leaving is_primary set is what
    // pointed the nightly export at the dead apex for a week (Session 1 fix;
    // migration 006 makes the two-primaries state unrepresentable).
    await controlQuery(
      `UPDATE domains SET verification_status = 'released', released_at = now(),
              cf_hostname_id = NULL, is_primary = false WHERE id = $1`,
      [d.id]
    );
    released.push(d.hostname);
  }
  await audit(actor, tenantId, "domains.released", { hostnames: released });
  return released;
}
