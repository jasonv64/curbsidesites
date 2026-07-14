/**
 * Reviews adapter entry point. Data-level demo selection (D5): live rows
 * exist → live; none → demo rows with the quiet "sample reviews" label.
 *
 * The integrations rows ('reviews_google', 'reviews_yelp') gate the FETCH
 * JOBS, not this read path — a broken key can never break a page because the
 * page only ever reads our own table.
 */
import { demoReviews } from "./demo";
import { liveReviews } from "./live";
import type { ReviewsData } from "./types";

export type { ReviewsData };

export async function getReviews(tenantId: string): Promise<ReviewsData> {
  const live = await liveReviews(tenantId);
  if (live.reviews.length > 0) return live;
  return demoReviews(tenantId);
}
