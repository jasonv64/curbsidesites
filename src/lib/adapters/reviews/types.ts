import type { ReviewRow } from "@/lib/schemas";

/**
 * Reviews adapter. Read path NEVER calls a vendor (D10): tenants read our
 * cached rows. live.ts holds the fetch-and-store functions the scheduled job
 * (Growth plane, Session 3) and scripts/fetch-reviews.ts call.
 */
export interface ReviewsData {
  reviews: ReviewRow[];
  /** null when there is nothing to aggregate. */
  aggregate: { count: number; rating: number } | null;
  /**
   * True when the rows shown are demo rows. Gates the "sample reviews" label
   * (D5) and — load-bearing — the aggregateRating JSON-LD (Invariant 7).
   */
  isDemo: boolean;
}

export interface ReviewFetchResult {
  source: "google" | "yelp";
  fetched: number;
  error?: string;
}
