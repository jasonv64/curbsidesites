import type { TenantBundle } from "@/lib/tenant";
import type { DisplayNumber } from "@/lib/adapters/call-tracking";

/**
 * What every section receives alongside its own props. Sections that need
 * integration data (reviews, instagram, booking) fetch it themselves through
 * their adapters — a section can never take down a page because adapters
 * always resolve (D11).
 */
export interface SectionData {
  bundle: TenantBundle;
  displayNumber: DisplayNumber;
}
