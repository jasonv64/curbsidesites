import type { TenantBundle } from "@/lib/tenant";
import { integrationFor, selectMode } from "../select";
import { demoQuoteAssistant } from "./demo";
import { liveQuoteAssistant } from "./live";
import type { QuoteAssistant, QuoteExchange } from "./types";

export type { QuoteAssistant, QuoteExchange };

export async function getQuoteAssistant(bundle: TenantBundle): Promise<QuoteAssistant> {
  const selected = await selectMode({
    tenantSlug: bundle.tenant.slug,
    key: "quote_assistant",
    integration: integrationFor(bundle, "quote_assistant"),
    fixAt: "src/lib/adapters/quote-assistant/live.ts → liveQuoteAssistant()",
  });
  return selected.mode === "live" ? liveQuoteAssistant() : demoQuoteAssistant(bundle);
}
