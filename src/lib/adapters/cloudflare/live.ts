/**
 * Real Cloudflare API (v4), plain fetch per repo convention (no SDKs, D3).
 * Requires: CLOUDFLARE_ZONE_ID (env) + secret `curbside-cloudflare-api-token`
 * with the Custom Hostnames edit permission. Session 4's runbook provisions
 * both; until then the demo provider serves.
 */
import type { CustomHostname, CustomHostnameProvider } from "./types";

const API = "https://api.cloudflare.com/client/v4";

function originTarget(): string {
  return process.env.CF_FALLBACK_ORIGIN ?? "sites-origin.curbsidesites.com";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStatus(raw: any): CustomHostname {
  const sslStatus: string = raw?.ssl?.status ?? raw?.status ?? "pending";
  return {
    id: raw.id,
    hostname: raw.hostname,
    status: sslStatus === "active" ? "active" : /fail|error|deleted/.test(sslStatus) ? "failed" : "pending",
    dns_targets: [
      { type: "CNAME", name: raw.hostname, value: originTarget() },
      ...(raw?.ownership_verification
        ? [{ type: raw.ownership_verification.type?.toUpperCase() ?? "TXT", name: raw.ownership_verification.name, value: raw.ownership_verification.value }]
        : []),
    ],
    errors: raw?.ssl?.validation_errors?.map((e: { message: string }) => e.message),
  };
}

export function liveCustomHostnames(token: string, zoneId: string): CustomHostnameProvider {
  async function cf(path: string, init?: RequestInit) {
    const res = await fetch(`${API}/zones/${zoneId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const body = await res.json();
    if (!res.ok || body.success === false) {
      throw new Error(`Cloudflare ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    }
    return body.result;
  }

  return {
    mode: "live",
    async create(hostname) {
      const result = await cf("/custom_hostnames", {
        method: "POST",
        body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } }),
      });
      return toStatus(result);
    },
    async status(id) {
      return toStatus(await cf(`/custom_hostnames/${id}`));
    },
    async remove(id) {
      await cf(`/custom_hostnames/${id}`, { method: "DELETE" });
    },
  };
}
