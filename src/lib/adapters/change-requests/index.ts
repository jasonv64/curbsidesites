import type { TenantBundle } from "@/lib/tenant";
import { integrationFor, selectMode } from "../select";
import { demoChangeParser } from "./demo";
import { liveChangeParser } from "./live";
import type { ChangeParser, ParsedChange } from "./types";

export type { ChangeParser, ParsedChange };

export async function getChangeParser(bundle: TenantBundle): Promise<ChangeParser> {
  const hours = bundle.profile?.hours ?? {};
  const selected = await selectMode({
    tenantSlug: bundle.tenant.slug,
    key: "change_request_ai",
    integration: integrationFor(bundle, "change_request_ai"),
    secretRequired: true,
    fixAt: "src/lib/adapters/change-requests/live.ts → liveChangeParser()",
  });
  if (selected.mode === "demo") return demoChangeParser(hours);
  const live = liveChangeParser(selected.secret as string, hours);
  const demo = demoChangeParser(hours);
  // Anthropic outage → demo parser still handles hours; page never breaks.
  return {
    parse: async (message) => {
      try {
        return await live.parse(message);
      } catch (e) {
        console.error("[adapter:change_request_ai] live parse failed; demo fallback:", e);
        return demo.parse(message);
      }
    },
  };
}
