/**
 * Demo Stripe: accepts simulated webhook posts from scripts/simulate-stripe.ts
 * (signature header literally "demo"). Only ever selected when the webhook
 * secret is NOT populated — a live deployment with the secret set can never
 * fall into accepting unsigned events.
 */
import type { StripeEvent, StripeProvider } from "./types";

export const demoStripe: StripeProvider = {
  mode: "demo",
  async verifyWebhook(rawBody, signatureHeader) {
    if (signatureHeader !== "demo") {
      throw new Error("demo Stripe provider only accepts simulated events (stripe-signature: demo)");
    }
    return JSON.parse(rawBody) as StripeEvent;
  },
};
