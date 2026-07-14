/**
 * Live Stripe webhook verification — the documented scheme (t=,v1= HMAC
 * SHA-256 over `${t}.${body}`), plain node:crypto, no SDK (D3 convention).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { StripeEvent, StripeProvider } from "./types";

const TOLERANCE_S = 300;

export function liveStripe(webhookSecret: string): StripeProvider {
  return {
    mode: "live",
    async verifyWebhook(rawBody, signatureHeader) {
      if (!signatureHeader) throw new Error("missing stripe-signature header");
      const parts = Object.fromEntries(
        signatureHeader.split(",").map((p) => p.split("=") as [string, string])
      );
      const t = parts["t"];
      const v1 = parts["v1"];
      if (!t || !v1) throw new Error("malformed stripe-signature header");
      if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_S) {
        throw new Error("stripe-signature timestamp outside tolerance");
      }
      const expected = createHmac("sha256", webhookSecret).update(`${t}.${rawBody}`).digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(v1);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error("stripe-signature verification failed");
      }
      return JSON.parse(rawBody) as StripeEvent;
    },
  };
}
