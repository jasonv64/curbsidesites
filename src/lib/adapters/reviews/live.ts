/**
 * Live reviews: (a) the read path over cached NON-demo rows, and (b) the
 * vendor fetchers that populate them. Fetchers run from scheduled jobs and
 * scripts/fetch-reviews.ts — NEVER from a request (D10). Plain fetch against
 * REST, no SDKs (D3).
 */
import { withTenant } from "@/lib/db";
import type { ReviewRow } from "@/lib/schemas";
import { aggregateOf } from "./demo";
import type { ReviewFetchResult, ReviewsData } from "./types";

export async function liveReviews(tenantId: string): Promise<ReviewsData> {
  const reviews = await withTenant(tenantId, (db) =>
    db.query<ReviewRow>(
      `SELECT id, source, author, rating, body, review_url, published_at, is_demo
         FROM reviews WHERE is_demo = false
        ORDER BY published_at DESC NULLS LAST LIMIT 12`
    )
  );
  return { reviews, aggregate: aggregateOf(reviews), isDemo: false };
}

// ---------------------------------------------------------------------------
// Fetchers (job-side). Each writes rows with is_demo = false; the read path
// flips from demo to live automatically once real rows exist (D5).
// ---------------------------------------------------------------------------

export async function fetchGoogleReviews(opts: {
  tenantId: string;
  placeId: string;
  apiKey: string;
}): Promise<ReviewFetchResult> {
  // Places API (New), Place Details with reviews field.
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(opts.placeId)}`,
    {
      headers: {
        "X-Goog-Api-Key": opts.apiKey,
        "X-Goog-FieldMask": "reviews,rating,userRatingCount",
      },
    }
  );
  if (!res.ok) throw new Error(`Google Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    reviews?: {
      name: string;
      rating: number;
      text?: { text?: string };
      authorAttribution?: { displayName?: string };
      publishTime?: string;
      googleMapsUri?: string;
    }[];
  };
  const reviews = data.reviews ?? [];
  await withTenant(opts.tenantId, async (db) => {
    for (const r of reviews) {
      await db.query(
        `INSERT INTO reviews (tenant_id, source, external_id, author, rating, body, review_url, published_at, is_demo)
         VALUES ($1, 'google', $2, $3, $4, $5, $6, $7, false)
         ON CONFLICT DO NOTHING`,
        [
          opts.tenantId,
          r.name,
          r.authorAttribution?.displayName ?? "Google user",
          r.rating,
          r.text?.text ?? "",
          r.googleMapsUri ?? null,
          r.publishTime ?? null,
        ]
      );
    }
  });
  return { source: "google", fetched: reviews.length };
}

export async function fetchYelpReviews(opts: {
  tenantId: string;
  businessId: string;
  apiKey: string;
}): Promise<ReviewFetchResult> {
  const res = await fetch(
    `https://api.yelp.com/v3/businesses/${encodeURIComponent(opts.businessId)}/reviews?limit=20&sort_by=newest`,
    { headers: { Authorization: `Bearer ${opts.apiKey}` } }
  );
  if (!res.ok) throw new Error(`Yelp Fusion ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    reviews?: {
      id: string;
      rating: number;
      text: string;
      url: string;
      time_created: string;
      user?: { name?: string };
    }[];
  };
  const reviews = data.reviews ?? [];
  await withTenant(opts.tenantId, async (db) => {
    for (const r of reviews) {
      await db.query(
        `INSERT INTO reviews (tenant_id, source, external_id, author, rating, body, review_url, published_at, is_demo)
         VALUES ($1, 'yelp', $2, $3, $4, $5, $6, $7, false)
         ON CONFLICT DO NOTHING`,
        [opts.tenantId, r.id, r.user?.name ?? "Yelp user", r.rating, r.text, r.url, r.time_created]
      );
    }
  });
  return { source: "yelp", fetched: reviews.length };
}
