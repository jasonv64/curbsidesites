/**
 * Analytics adapter — Plausible (chosen in ASSUMPTIONS.md per D3 "pick one").
 * No-ops when unconfigured. Conversions ALWAYS write to our own events table
 * regardless of this adapter's mode (D14) — the vendor is a supplement, our
 * events table is the record.
 */
export interface AnalyticsSetup {
  enabled: boolean;
  /** Plausible data-domain, e.g. "ironridgeoffroad.com". */
  dataDomain: string | null;
  scriptSrc: string;
}
