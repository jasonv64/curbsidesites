import type { TenantBundle } from "@/lib/tenant";
import { guarded, integrationFor, selectMode } from "../select";
import { demoNewsletterSync } from "./demo";
import { liveNewsletterSync } from "./live";

export async function syncSubscriber(
  bundle: TenantBundle,
  email: string
): Promise<{ synced: boolean; demo: boolean }> {
  const selected = await selectMode({
    tenantSlug: bundle.tenant.slug,
    key: "newsletter",
    integration: integrationFor(bundle, "newsletter"),
    requiredConfig: ["audience_id"],
    secretRequired: true,
    fixAt: "src/lib/adapters/newsletter/live.ts → liveNewsletterSync()",
  });
  if (selected.mode === "demo") return demoNewsletterSync.sync(email);
  const { result } = await guarded({
    tenantId: bundle.tenant.id,
    key: "newsletter",
    live: () => liveNewsletterSync(selected.secret as string, selected.config).sync(email),
    demo: () => demoNewsletterSync.sync(email),
  });
  return result;
}
