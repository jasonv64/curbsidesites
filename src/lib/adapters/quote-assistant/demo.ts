import type { TenantBundle } from "@/lib/tenant";
import type { QuoteAssistant } from "./types";

/**
 * Canned keyword responses so the widget demos convincingly. Every reply is
 * explicit that it's a sample and routes to the phone — never a number the
 * shop would have to honor.
 */
export function demoQuoteAssistant(bundle: TenantBundle): QuoteAssistant {
  const phone = bundle.profile?.nap?.phone_display ?? "the shop";
  const rules: [RegExp, string][] = [
    [/lift|level/i, "Sample estimate: most lift and leveling installs run $450–$1,800 in labor depending on the kit and alignment needs."],
    [/tire|wheel/i, "Sample estimate: mounting and balancing a set typically runs $120–$260; larger setups may need trimming or regearing — worth a quick call."],
    [/outboard|engine|motor|service/i, "Sample estimate: an annual service typically runs $250–$600 depending on engine hours and what we find."],
    [/winter|layup|storage/i, "Sample estimate: an off-season layup package typically runs $300–$500."],
    [/gel ?coat|detail|buff/i, "Sample estimate: gelcoat restoration usually quotes per foot — roughly $40–$75/ft depending on oxidation."],
  ];
  return {
    async ask(message: string) {
      const hit = rules.find(([re]) => re.test(message));
      const base = hit
        ? hit[1]
        : "Sample answer: that one needs a real look before we can put a number on it.";
      return {
        reply: `${base} This assistant is running in demo mode — for a real quote, call ${phone} or use the quote form and we'll get back to you fast.`,
        isDemo: true,
      };
    },
  };
}
