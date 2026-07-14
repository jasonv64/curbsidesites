import type { AnalyticsSetup } from "./types";

/** Plausible is cookieless script-tag analytics; config is just the domain. */
export function liveAnalytics(config: Record<string, string>): AnalyticsSetup {
  return {
    enabled: true,
    dataDomain: config.domain,
    scriptSrc: config.script_src ?? "https://plausible.io/js/script.js",
  };
}
