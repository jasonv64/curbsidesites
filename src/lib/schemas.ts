/**
 * Zod schemas — the single source of truth for shape (TENANT-APP Part 3).
 * Shared between DB write validation, Server Actions, and client components.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// NAP + hours (Invariant 6: NAP has exactly one home — business_profile.nap)
// ---------------------------------------------------------------------------

export const napSchema = z.object({
  name: z.string().min(1),
  street: z.string().min(1),
  city: z.string().min(1),
  region: z.string().min(2), // "CA"
  postal: z.string().min(5),
  phone_display: z.string().min(7), // "(760) 555-0134"
  phone_tel: z.string().regex(/^\+1\d{10}$/), // "+17605550134"
});
export type Nap = z.infer<typeof napSchema>;

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const timeRange = z.tuple([
  z.string().regex(/^\d{2}:\d{2}$/),
  z.string().regex(/^\d{2}:\d{2}$/),
]);
/** {} or missing day = closed. Each day: array of [open, close] ranges. */
export const hoursSchema = z.partialRecord(z.enum(DAY_KEYS), z.array(timeRange));
export type Hours = z.infer<typeof hoursSchema>;

export const geoSchema = z.object({ lat: z.number(), lng: z.number() });

export const socialsSchema = z
  .object({
    instagram: z.string().optional(),
    facebook: z.string().optional(),
    youtube: z.string().optional(),
    tiktok: z.string().optional(),
    google_maps_url: z.string().optional(),
    yelp_url: z.string().optional(),
  })
  .partial();

export const businessProfileSchema = z.object({
  nap: napSchema,
  hours: hoursSchema,
  geo: geoSchema.nullish(),
  socials: socialsSchema,
  service_area: z.array(z.string()),
  schema_subtype: z.string().min(1),
  tagline: z.string().nullish(),
  about: z.string().nullish(),
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

// ---------------------------------------------------------------------------
// Brand tokens (TENANT-APP Part 6) — semantic tokens only, hex values
// ---------------------------------------------------------------------------

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const brandTokensSchema = z.object({
  brand: hex,
  brand_dark: hex,
  surface: hex,
  surface_raised: hex,
  ink: hex,
  ink_muted: hex,
  edge: hex,
  accent: hex,
});
export type BrandTokens = z.infer<typeof brandTokensSchema>;

// ---------------------------------------------------------------------------
// Content frontmatter (D18) — dates as plain YYYY-MM-DD strings
// ---------------------------------------------------------------------------

export const frontmatterSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  author: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
export type Frontmatter = z.infer<typeof frontmatterSchema>;

export const slugSchema = z.string().regex(/^[a-z0-9-]+$/);

// ---------------------------------------------------------------------------
// Lead intake (quote / info request form)
// ---------------------------------------------------------------------------

export const leadInputSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200).optional().or(z.literal("")),
  phone: z
    .string()
    .regex(/^[\d\s().+-]{7,20}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  preferred: z.enum(["phone", "email", "text"]).default("phone"),
  service: z.string().max(120).optional().or(z.literal("")),
  vehicle: z.string().max(200).optional().or(z.literal("")),
  message: z.string().min(5).max(4000),
  // honeypot — real users never fill this
  website: z.string().max(0).optional().or(z.literal("")),
});
export type LeadInput = z.infer<typeof leadInputSchema>;

export const subscriberInputSchema = z.object({
  email: z.string().email().max(200),
  website: z.string().max(0).optional().or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Change requests (D9) — the typed diffs the AI may propose. Anything that
// doesn't fit one of these escalates; nothing is ever free-form applied.
// ---------------------------------------------------------------------------

export const changeDiffSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hours_update"), hours: hoursSchema }),
  z.object({
    kind: z.literal("service_update"),
    slug: slugSchema,
    name: z.string().min(1).optional(),
    blurb: z.string().optional(),
  }),
  z.object({
    kind: z.literal("service_add"),
    slug: slugSchema,
    name: z.string().min(1),
    blurb: z.string().default(""),
  }),
  z.object({ kind: z.literal("tagline_update"), tagline: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("escalate"), reason: z.string() }),
]);
export type ChangeDiff = z.infer<typeof changeDiffSchema>;

// ---------------------------------------------------------------------------
// Tenant rows as the app reads them
// ---------------------------------------------------------------------------

export type TenantStatus = "draft" | "live" | "suspended";
export type PlanTier = "curb" | "curb_plus" | "curb_pro";

export interface TenantRow {
  id: string;
  slug: string;
  business_name: string;
  status: TenantStatus;
  plan_tier: PlanTier;
  features: Record<string, boolean>;
  owner_email: string | null;
  preview_token: string;
}

export interface ServiceRow {
  id: string;
  slug: string;
  name: string;
  blurb: string;
  body: string;
  sort_order: number;
}

export interface ImageRow {
  slot_id: string;
  purpose: string;
  aspect: string;
  alt: string;
  url: string | null;
  credit: string | null;
}

export interface ReviewRow {
  id: string;
  source: "google" | "yelp";
  author: string;
  rating: number;
  body: string;
  review_url: string | null;
  published_at: string | null;
  is_demo: boolean;
}

export interface ContentRow {
  id: string;
  type: "post" | "page";
  slug: string;
  frontmatter: Frontmatter;
  body: string;
  published_at: string | null;
  updated_at: string;
}

export interface LeadRow {
  id: string;
  name: string;
  contact: { email?: string; phone?: string; preferred?: string };
  service: string | null;
  vehicle: string | null;
  message: string;
  photo_urls: string[];
  source: string;
  status: "new" | "contacted" | "quoted" | "won" | "lost";
  notes: { at: string; text: string }[];
  is_demo: boolean;
  created_at: string;
}

export interface IntegrationRow {
  key: string;
  mode: "live" | "demo";
  config: Record<string, string>;
  kv_secret_ref: string | null;
  key_owner: "client" | "curbside";
  last_error_at: string | null;
  last_error: string | null;
}
