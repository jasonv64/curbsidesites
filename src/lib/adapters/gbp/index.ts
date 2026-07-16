/**
 * GBP adapter entry point (D11 shape). Job-side only — no tenant page ever
 * calls this (D10); the drift monitor and future GBP ops do.
 */
import { controlOne } from "@/lib/control/db";
import { secretProvider } from "@/lib/secrets";
import { demoGbpSnapshot } from "./demo";
import { liveGbpSnapshot } from "./live";
import type { GbpSnapshot } from "./types";

export type { GbpNap, GbpSnapshot } from "./types";

export async function getGbpSnapshot(tenantId: string, tenantSlug: string): Promise<GbpSnapshot> {
  const row = await controlOne<{ mode: string; config: Record<string, string>; kv_secret_ref: string | null }>(
    "SELECT mode, config, kv_secret_ref FROM integrations WHERE tenant_id = $1 AND key = 'gbp'",
    [tenantId]
  );
  if (!row || row.mode !== "live") return demoGbpSnapshot();

  // Half-configured is loud (D11): live without the pieces is an error the
  // job runner surfaces as an alert, never a silent demo.
  if (!row.config?.location_id) {
    throw new Error(
      `gbp is flagged LIVE for '${tenantSlug}' but config.location_id is missing. ` +
        `Set it on the integration row or flip mode back to demo. Fix at: src/lib/adapters/gbp/live.ts`
    );
  }
  const token = row.kv_secret_ref ? await secretProvider().get(row.kv_secret_ref) : null;
  if (!token) {
    throw new Error(
      `gbp is flagged LIVE for '${tenantSlug}' but secret '${row.kv_secret_ref}' is not populated. ` +
        `Populate it or flip mode back to demo. Fix at: src/lib/adapters/gbp/live.ts`
    );
  }
  return liveGbpSnapshot(row.config, token);
}
