import type { QuoteAssistant } from "./types";

// TODO: LIVE — Anthropic API (D3), grounded in the shop's real price book
// (a prices config the owner maintains in the portal), with a hard rule that
// it gives RANGES, never commitments, and always offers the phone number.
// Requires: 'quote_assistant' integration row, kv_secret_ref →
// curbside-anthropic-api-key.
export function liveQuoteAssistant(): QuoteAssistant {
  throw new Error(
    "quote_assistant live mode is not implemented in v1. " +
      "Edit src/lib/adapters/quote-assistant/live.ts → liveQuoteAssistant(). " +
      "Until then the integration row must stay mode='demo'."
  );
}
