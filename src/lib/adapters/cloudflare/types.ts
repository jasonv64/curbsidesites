/**
 * Cloudflare for SaaS — Custom Hostnames (D15). A PLATFORM adapter: one
 * Cloudflare account fronts every client domain, so unlike tenant
 * integrations there is no per-tenant row — config is platform env + the
 * platform secret `curbside-cloudflare-api-token`.
 */
export interface CustomHostname {
  /** Cloudflare's id for the custom hostname (stored on domains.cf_hostname_id). */
  id: string;
  hostname: string;
  status: "pending" | "active" | "failed";
  /** DNS records the CLIENT must create at their registrar. */
  dns_targets: { type: string; name: string; value: string }[];
  errors?: string[];
}

export interface CustomHostnameProvider {
  readonly mode: "live" | "demo";
  create(hostname: string): Promise<CustomHostname>;
  status(id: string, hostname: string): Promise<CustomHostname>;
  remove(id: string): Promise<void>;
}
