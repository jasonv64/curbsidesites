import { withTenant } from "@/lib/db";
import type { ReviewRow } from "@/lib/schemas";
import type { ReviewsData } from "./types";

/** Demo = the tenant's seeded is_demo review rows (D5: realistic, localized). */
export async function demoReviews(tenantId: string): Promise<ReviewsData> {
  const reviews = await withTenant(tenantId, (db) =>
    db.query<ReviewRow>(
      `SELECT id, source, author, rating, body, review_url, published_at, is_demo
         FROM reviews WHERE is_demo = true
        ORDER BY published_at DESC NULLS LAST LIMIT 12`
    )
  );
  return { reviews, aggregate: aggregateOf(reviews), isDemo: true };
}

export function aggregateOf(reviews: ReviewRow[]): ReviewsData["aggregate"] {
  if (reviews.length === 0) return null;
  const sum = reviews.reduce((a, r) => a + Number(r.rating), 0);
  return { count: reviews.length, rating: Math.round((sum / reviews.length) * 10) / 10 };
}
