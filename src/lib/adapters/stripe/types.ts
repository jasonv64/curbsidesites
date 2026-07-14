/**
 * Stripe Billing (D7, Part 4) — platform adapter. v1 scope: ingest webhooks
 * (signature-verified) and keep billing + tenants.plan_tier + feature flags
 * in sync. Creating products/subscriptions happens in the Stripe dashboard /
 * Session 4 runbook; the platform's job is to REFLECT billing state, and to
 * never suspend anyone without a human.
 */
export interface StripeEvent {
  id: string;
  type: string;
  /** Unix seconds — used as the failure timestamp for dunning math. */
  created: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: { object: any };
}

export interface StripeProvider {
  readonly mode: "live" | "demo";
  /** Parse + authenticate a webhook request body. Throws on bad signature. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<StripeEvent>;
}
