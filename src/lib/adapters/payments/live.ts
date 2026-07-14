import type { PaymentsPresentation } from "./types";

// TODO: LIVE — Stripe Connect Standard (D7).
// Implementation seam: create a Checkout Session on the CLIENT's connected
// account with an application fee, return its URL. Requires: Stripe Connect
// onboarding for the tenant, 'payments' integration row with
// config.stripe_account_id and kv_secret_ref → Curbside's platform key.
export function livePayments(): PaymentsPresentation {
  throw new Error(
    "payments live mode is not implemented in v1 (D7: processing is deferred). " +
      "Edit src/lib/adapters/payments/live.ts → livePayments() when Stripe Connect ships. " +
      "Until then the integration row must stay mode='demo'."
  );
}
