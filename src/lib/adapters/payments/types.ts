/**
 * Payments adapter — STUB (D7: billing yes, processing no in v1).
 * When it ships it ships as Stripe Connect Standard: the client is the
 * merchant of record, Curbside takes an application fee, chargeback liability
 * stays with the merchant. We never become the aggregator.
 *
 * Demo mode is an explicit, friendly "not live yet" callout with the shop's
 * phone number. NEVER a fake success (it's a real invoice), never an error.
 */
export type PaymentsPresentation =
  | {
      kind: "demo_callout";
      message: string;
      phoneDisplay: string | null;
      phoneTel: string | null;
    }
  | {
      kind: "live_checkout";
      /** // TODO: LIVE — Stripe Connect checkout session URL builder. */
      checkoutUrl: string;
    };
