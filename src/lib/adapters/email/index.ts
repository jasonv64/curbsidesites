import type { TenantBundle } from "@/lib/tenant";
import { guarded, integrationFor, selectMode } from "../select";
import { demoEmailSender } from "./demo";
import { liveEmailSender } from "./live";
import type { EmailMessage, EmailResult } from "./types";

export type { EmailMessage, EmailResult };

/**
 * Send an email for a tenant. Live requires the 'email' integration row
 * (config.from + kv_secret_ref → Resend API key). A provider outage falls
 * back to the demo sender (console) and records last_error_at — the lead is
 * still in the DB either way; delivery gets retried by ops, not lost.
 */
export async function sendTenantEmail(
  bundle: TenantBundle,
  msg: EmailMessage
): Promise<EmailResult> {
  const selected = await selectMode({
    tenantSlug: bundle.tenant.slug,
    key: "email",
    integration: integrationFor(bundle, "email"),
    requiredConfig: ["from"],
    secretRequired: true,
    fixAt: "src/lib/adapters/email/live.ts → liveEmailSender()",
  });
  if (selected.mode === "demo") return demoEmailSender.send(msg);
  const { result } = await guarded({
    tenantId: bundle.tenant.id,
    key: "email",
    live: () => liveEmailSender(selected.secret as string, selected.config).send(msg),
    demo: () => demoEmailSender.send(msg),
  });
  return result;
}
