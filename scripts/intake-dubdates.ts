/**
 * One-off: run the real intake pipeline for the dubdating.com simulated client
 * (ONBOARDING.md). Calls exactly what the public server action calls —
 * intakeSchema validation, then createTenantFromIntake — skipping only the
 * HTTP layer and its rate limit. Anything this accepts, the form accepts.
 *
 * Deliberately NOT idempotent: the slug deduper would make a second run create
 * `dub-dates-2` rather than fail, which is the form's real behaviour.
 *
 * Usage: source ~/.curbside-env-01 && npx tsx scripts/intake-dubdates.ts
 */
import { intakeSchema } from "@/lib/control/intake-schema";
import { createTenantFromIntake } from "@/lib/control/onboarding";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

const HOURS = {
  mon: { closed: false, open: "09:00", close: "18:00" },
  tue: { closed: false, open: "09:00", close: "18:00" },
  wed: { closed: false, open: "09:00", close: "18:00" },
  thu: { closed: false, open: "09:00", close: "18:00" },
  fri: { closed: false, open: "09:00", close: "18:00" },
  sat: { closed: false, open: "10:00", close: "16:00" },
  sun: { closed: true, open: "09:00", close: "17:00" },
};

async function main() {
  const input = intakeSchema.parse({
    business_name: "Dub Dates",
    // No dating category exists — the industry list is trades-only. `general`
    // maps to schema.org LocalBusiness, which is the least-wrong subtype.
    industry: "general",
    street: "LA Street",
    city: "Riverside",
    region: "CA",
    postal: "92577",
    phone: "1231231231",
    email: "valaj045@gmail.com",
    hours: HOURS,
    service_area: "Los Angeles, San Diego, Phoenix, Dallas, Chicago",
    services: [
      { name: "Curated Matching", blurb: "Hand-reviewed introductions in your city, not an endless swipe feed." },
      { name: "Profile Review", blurb: "A real person reads your profile and tells you what's landing and what isn't." },
      { name: "Date Night Planning", blurb: "Vetted venue picks for a first date that isn't another coffee shop." },
    ],
    voice:
      "We started Dub Dates because dating apps got loud and lonely at the same time. " +
      "We keep it small and local — real introductions in your city, a real person behind them, " +
      "and no games about what things cost.",
    // D8: the registrar NAME only, never credentials. This is what selects the
    // GoDaddy-specific DNS instructions when the domain is provisioned.
    registrar: "GoDaddy",
    existing_domain: "dubdating.com",
    addons: ["seo", "blog", "crm"],
    consent_terms: true,
    consent_recording: false,
  });

  const result = await createTenantFromIntake(input);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
