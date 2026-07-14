/**
 * AI quote assistant — STUB (à la carte, $149/mo, D19). Intakes a job
 * description, returns a ballpark. Demo returns canned, clearly-labeled
 * responses. // TODO: LIVE — Anthropic API with the shop's real price book.
 */
export interface QuoteExchange {
  reply: string;
  isDemo: boolean;
}

export interface QuoteAssistant {
  ask(message: string): Promise<QuoteExchange>;
}
