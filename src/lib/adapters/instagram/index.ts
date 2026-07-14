import type { TenantBundle } from "@/lib/tenant";
import { guarded, integrationFor, selectMode } from "../select";
import { demoInstagram } from "./demo";
import { liveInstagram } from "./live";
import type { InstagramFeed } from "./types";

export type { InstagramFeed };

export async function getInstagramFeed(bundle: TenantBundle): Promise<InstagramFeed> {
  const selected = await selectMode({
    tenantSlug: bundle.tenant.slug,
    key: "instagram",
    integration: integrationFor(bundle, "instagram"),
    secretRequired: true, // the Graph API token, needed by the fetch job
    fixAt: "src/lib/adapters/instagram/live.ts → liveInstagram()",
  });
  if (selected.mode === "demo") return demoInstagram(bundle);
  const { result } = await guarded({
    tenantId: bundle.tenant.id,
    key: "instagram",
    live: () => liveInstagram(bundle),
    demo: async () => demoInstagram(bundle),
  });
  return result;
}
