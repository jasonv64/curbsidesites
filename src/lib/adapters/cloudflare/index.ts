/**
 * Live/demo selection for the platform Cloudflare adapter. Same D11 rules as
 * tenant integrations, platform-scoped: zone id set + token populated → live;
 * neither → demo; HALF-configured → throw naming the fix (never silently
 * serve demo while the operator believes domains are real).
 */
import { secretProvider } from "@/lib/secrets";
import { demoCustomHostnames } from "./demo";
import { liveCustomHostnames } from "./live";
import type { CustomHostnameProvider } from "./types";

export type { CustomHostname, CustomHostnameProvider } from "./types";

export async function customHostnames(): Promise<CustomHostnameProvider> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) return demoCustomHostnames;
  const token = await secretProvider().get("curbside-cloudflare-api-token");
  if (!token) {
    throw new Error(
      "CLOUDFLARE_ZONE_ID is set but secret 'curbside-cloudflare-api-token' is not populated. " +
        "Half-configured is worse than unconfigured (D11). Populate the secret or unset CLOUDFLARE_ZONE_ID. " +
        "Fix at: src/lib/adapters/cloudflare/index.ts"
    );
  }
  return liveCustomHostnames(token, zoneId);
}
