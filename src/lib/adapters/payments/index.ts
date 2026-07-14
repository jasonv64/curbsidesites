import type { TenantBundle } from "@/lib/tenant";
import { integrationFor, selectMode } from "../select";
import { demoPayments } from "./demo";
import { livePayments } from "./live";
import type { PaymentsPresentation } from "./types";

export type { PaymentsPresentation };

export async function getPayments(bundle: TenantBundle): Promise<PaymentsPresentation> {
  const selected = await selectMode({
    tenantSlug: bundle.tenant.slug,
    key: "payments",
    integration: integrationFor(bundle, "payments"),
    fixAt: "src/lib/adapters/payments/live.ts → livePayments()",
  });
  // live mode throws by design until Connect ships — half-configured must be
  // loud, not silently demo (D11).
  return selected.mode === "live" ? livePayments() : demoPayments(bundle);
}
