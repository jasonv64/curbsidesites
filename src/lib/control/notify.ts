/**
 * Control-plane email + staff notifications. This is CURBSIDE's own sending
 * (intake receipts, registrar instructions, dunning warnings, staff pings) —
 * distinct from sendTenantEmail(), which sends on behalf of a tenant.
 *
 * Live: Resend with the platform key (secret ref `curbside-resend-api-key`,
 * same convention as SECRETS.md). Missing key → console delivery, exactly like
 * the tenant email adapter's demo mode. Nothing here ever throws to a caller:
 * a notification failure must never abort a pipeline.
 */
import { secretProvider } from "@/lib/secrets";
import { controlQuery } from "@/lib/control/db";

export interface PlatformEmail {
  to: string;
  subject: string;
  text: string;
}

export async function sendPlatformEmail(msg: PlatformEmail): Promise<{ delivered: "live" | "console" }> {
  const from = process.env.PLATFORM_EMAIL_FROM ?? "Curbside Sites <hello@curbsidesites.com>";
  try {
    const key = await secretProvider().get("curbside-resend-api-key");
    if (key) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { delivered: "live" };
    }
  } catch (e) {
    console.error("[notify] live send failed, falling back to console:", e instanceof Error ? e.message : e);
  }
  console.log(
    `\n─── platform email (console delivery) ───\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n──────────────────────────────────────────\n`
  );
  return { delivered: "console" };
}

/**
 * Ping staff: email to STAFF_NOTIFY_EMAIL (console fallback) AND an alerts row
 * so it lands on the dashboard even when nobody reads the inbox.
 */
export async function notifyStaff(opts: {
  tenantId?: string | null;
  kind: string;
  severity?: "info" | "warn" | "critical";
  message: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await controlQuery(
      `INSERT INTO alerts (tenant_id, kind, severity, message, detail) VALUES ($1, $2, $3, $4, $5)`,
      [opts.tenantId ?? null, opts.kind, opts.severity ?? "info", opts.message, JSON.stringify(opts.detail ?? {})]
    );
  } catch (e) {
    console.error("[notify] failed to write alert:", e);
  }
  const to = process.env.STAFF_NOTIFY_EMAIL;
  if (to) {
    await sendPlatformEmail({
      to,
      subject: `[curbside ${opts.severity ?? "info"}] ${opts.message}`,
      text: JSON.stringify(opts.detail ?? {}, null, 2),
    });
  }
}
