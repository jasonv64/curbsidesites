/**
 * Conversion events (D14): business outcomes, not web metrics. These are the
 * numbers the monthly report leads with. Pageviews never appear here.
 */
import { withTenant } from "@/lib/db";

export const CONVERSION_TYPES = [
  "call_tap",
  "form_submit",
  "map_tap",
  "newsletter_signup",
  "booking_started",
  "booking_completed",
] as const;
export type ConversionType = (typeof CONVERSION_TYPES)[number];

export const SOURCES = ["organic", "direct", "gbp", "instagram", "referral"] as const;
export type Source = (typeof SOURCES)[number];

export async function trackEvent(
  tenantId: string,
  type: ConversionType,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    await withTenant(tenantId, (db) =>
      db.query("INSERT INTO events (tenant_id, type, payload) VALUES ($1, $2, $3)", [
        tenantId,
        type,
        JSON.stringify(payload),
      ])
    );
  } catch (e) {
    // Analytics must never break a conversion path.
    console.error("[events] failed to record", type, e);
  }
}

/** Map a referrer + utm_source to our source attribution set. */
export function attributeSource(referrer: string | null, utmSource: string | null): Source {
  const u = (utmSource ?? "").toLowerCase();
  if (u.includes("gbp") || u.includes("google_business")) return "gbp";
  if (u.includes("instagram")) return "instagram";
  const r = (referrer ?? "").toLowerCase();
  if (r.includes("instagram.com")) return "instagram";
  if (r.includes("google.")) return "organic";
  if (r.includes("bing.") || r.includes("duckduckgo.") || r.includes("yahoo.")) return "organic";
  if (r === "") return "direct";
  return "referral";
}
