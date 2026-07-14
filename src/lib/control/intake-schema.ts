/**
 * The intake form's shape (Part 2.1) and the consent language (Part 2.2).
 *
 * The form's output is DATABASE ROWS, not a document: this schema is what the
 * onboarding pipeline (src/lib/control/onboarding.ts) turns into a draft
 * tenant in one transaction. The add-on checkboxes ARE the feature flags
 * (D19) — there is no transcription step anywhere in this path.
 */
import { z } from "zod";
import { DAY_KEYS } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Consent language (2.2.1). A distinct, separately-checked consent — never
// bundled into terms. The exact text is stored on the consents row.
// ⚖️ Get a lawyer to review this language before the first real call
// (CONTROL-PLANE 2.2 — cheapest insurance in the business).
// ---------------------------------------------------------------------------

export const RECORDING_CONSENT_TEXT = [
  "I agree that my onboarding call with Curbside Sites will be recorded and transcribed.",
  "The recording and transcript will be processed by Anthropic (an AI service) and used to",
  "generate marketing content in my business's voice for the life of my account.",
  "The recording and transcript are retained while my account is active.",
  "I can withdraw this consent at any time by emailing hello@curbsidesites.com or asking in",
  "my site portal; withdrawal deletes the recording and the transcript.",
].join(" ");

export const TERMS_CONSENT_TEXT =
  "I agree to the Curbside Sites terms of service and authorize Curbside Sites to build and host a website for my business.";

// ---------------------------------------------------------------------------
// Industries — drives schema.org subtype + the brand proposal heuristics
// ---------------------------------------------------------------------------

export const INDUSTRIES = {
  automotive: { label: "Automotive / Off-road", subtype: "AutoRepair" },
  marine: { label: "Marine / Boat service", subtype: "LocalBusiness" },
  hvac: { label: "Heating & Air (HVAC)", subtype: "HVACBusiness" },
  plumbing: { label: "Plumbing", subtype: "Plumber" },
  electrical: { label: "Electrical", subtype: "Electrician" },
  roofing: { label: "Roofing", subtype: "RoofingContractor" },
  landscaping: { label: "Landscaping / Outdoor", subtype: "Landscaper" },
  fencing: { label: "Fencing / Welding / Fabrication", subtype: "GeneralContractor" },
  painting: { label: "Painting", subtype: "HousePainter" },
  cleaning: { label: "Cleaning / Detailing", subtype: "LocalBusiness" },
  general: { label: "Other local service", subtype: "LocalBusiness" },
} as const;
export type IndustryKey = keyof typeof INDUSTRIES;

/** D8: we ask WHICH registrar — the name, nothing more. Never credentials. */
export const REGISTRARS = [
  "GoDaddy",
  "Namecheap",
  "Squarespace Domains (ex-Google)",
  "Cloudflare",
  "IONOS",
  "Network Solutions",
  "Other / not sure",
  "No domain yet",
] as const;

/** The add-on checkboxes ARE the feature flags (D19). Key = tenants.features key. */
export const ADDON_FLAGS = {
  crm: "CRM",
  payments: "Online payments",
  booking: "Online booking",
  blog: "Blog",
  seo: "Local SEO / visibility",
  monthly_reporting: "Monthly reporting",
  call_tracking: "Call tracking",
} as const;

// ---------------------------------------------------------------------------
// The form schema
// ---------------------------------------------------------------------------

const dayHours = z.object({
  closed: z.boolean().default(false),
  open: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
  close: z.string().regex(/^\d{2}:\d{2}$/).default("17:00"),
});

export const intakeSchema = z.object({
  // Business identity
  business_name: z.string().min(2).max(120),
  industry: z.enum(Object.keys(INDUSTRIES) as [IndustryKey, ...IndustryKey[]]),
  street: z.string().min(3).max(200),
  city: z.string().min(2).max(100),
  region: z.string().min(2).max(2).default("CA"),
  postal: z.string().regex(/^\d{5}(-\d{4})?$/),
  phone: z.string().regex(/^[\d\s().+-]{10,20}$/, "Enter a 10-digit US phone number"),
  email: z.string().email().max(200),
  hours: z.partialRecord(z.enum(DAY_KEYS), dayHours),
  service_area: z.string().min(2).max(500), // comma-separated towns
  instagram: z.string().max(100).optional().or(z.literal("")),
  facebook: z.string().max(200).optional().or(z.literal("")),
  google_maps_url: z.string().max(300).optional().or(z.literal("")),

  // Services — name + short description, repeatable
  services: z
    .array(
      z.object({
        name: z.string().min(2).max(120),
        blurb: z.string().max(300).default(""),
      })
    )
    .min(1)
    .max(12),

  // Voice — their own words; the 2.2.3 fallback voice source
  voice: z.string().min(10).max(4000),

  // Domain (D8: registrar NAME only)
  registrar: z.enum(REGISTRARS),
  existing_domain: z
    .string()
    .max(200)
    .regex(/^$|^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a bare domain like shopname.com")
    .optional()
    .or(z.literal("")),

  // Add-ons: checkboxes = feature flags (D19)
  addons: z.array(z.enum(Object.keys(ADDON_FLAGS) as [string, ...string[]])).default([]),

  // Consents (2.2). Terms required; recording consent is OPTIONAL and distinct
  // — the pipeline must work without it (the call proceeds unrecorded).
  consent_terms: z.literal(true, { error: "The terms consent is required to proceed." }),
  consent_recording: z.boolean().default(false),

  // honeypot
  website: z.string().max(0).optional().or(z.literal("")),
});

export type IntakeInput = z.infer<typeof intakeSchema>;
