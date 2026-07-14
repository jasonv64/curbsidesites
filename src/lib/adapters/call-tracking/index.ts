import type { TenantBundle } from "@/lib/tenant";
import { integrationFor, selectMode } from "../select";
import { demoDisplayNumber } from "./demo";
import { liveDisplayNumber } from "./live";
import type { DisplayNumber } from "./types";

export type { DisplayNumber };

/**
 * The number PAGES render (Invariant 6: rendered page only). Everything that
 * feeds a citation surface must use bundle.profile.nap directly instead.
 */
export async function getDisplayNumber(bundle: TenantBundle): Promise<DisplayNumber> {
  const nap = bundle.profile?.nap;
  if (!nap) return { display: "", tel: "", tracked: false };
  const selected = await selectMode({
    tenantSlug: bundle.tenant.slug,
    key: "call_tracking",
    integration: integrationFor(bundle, "call_tracking"),
    requiredConfig: ["dni_display", "dni_tel"],
    fixAt: "src/lib/adapters/call-tracking/live.ts → liveDisplayNumber()",
  });
  return selected.mode === "live" ? liveDisplayNumber(selected.config) : demoDisplayNumber(nap);
}
