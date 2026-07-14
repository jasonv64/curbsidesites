import type { AnalyticsSetup } from "./types";

/** Unconfigured → no vendor script at all. Our events table still records. */
export function demoAnalytics(): AnalyticsSetup {
  return { enabled: false, dataDomain: null, scriptSrc: "" };
}
