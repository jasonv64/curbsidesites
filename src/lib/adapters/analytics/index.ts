import type { TenantBundle } from "@/lib/tenant";
import { integrationFor, selectMode } from "../select";
import { demoAnalytics } from "./demo";
import { liveAnalytics } from "./live";
import type { AnalyticsSetup } from "./types";

export type { AnalyticsSetup };

export async function getAnalytics(bundle: TenantBundle): Promise<AnalyticsSetup> {
  const selected = await selectMode({
    tenantSlug: bundle.tenant.slug,
    key: "analytics",
    integration: integrationFor(bundle, "analytics"),
    requiredConfig: ["domain"],
    secretRequired: false,
    fixAt: "src/lib/adapters/analytics/live.ts → liveAnalytics()",
  });
  return selected.mode === "live" ? liveAnalytics(selected.config) : demoAnalytics();
}
