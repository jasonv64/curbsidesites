import { secretProvider } from "@/lib/secrets";
import { demoStripe } from "./demo";
import { liveStripe } from "./live";
import type { StripeProvider } from "./types";

export type { StripeEvent, StripeProvider } from "./types";

/** Secret populated → live verification; absent → demo simulation only. */
export async function stripeProvider(): Promise<StripeProvider> {
  const secret = await secretProvider().get("curbside-stripe-webhook-secret");
  return secret ? liveStripe(secret) : demoStripe;
}
