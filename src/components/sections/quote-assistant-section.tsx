import { QuoteAssistantWidget } from "./quote-assistant-widget";
import type { SectionData } from "@/lib/section-data";

/** Feature-flag-gated wrapper (D19: the checkbox IS the flag). */
export function QuoteAssistantSection({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string };
}) {
  if (!data.bundle.tenant.features?.quote_assistant) return null;
  return <QuoteAssistantWidget heading={props.heading ?? "Instant ballpark"} />;
}
