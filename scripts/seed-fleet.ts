/**
 * Demo fleet seed (CONTROL-PLANE Part 11.2): ~6 tenants in mixed states so
 * the dashboard has something real to show, plus the first staff user.
 *
 *   iron-ridge-offroad    live, healthy            (from db:seed, billing added here)
 *   delta-marine-service  live, healthy            (from db:seed, billing added here)
 *   high-desert-fence     DRAFT mid-onboarding: brand gate pending, consented,
 *                         call scheduled, intake receipt on file
 *   sunrise-pool-care     live, ONE FAILING INTEGRATION (reviews_google live
 *                         with a bad key → demo fallback + last_error_at)
 *   valley-heating-air    SUSPENDED for non-payment (full dunning history)
 *   bayside-detailing     live, ZERO form submissions in 30+ days (had a
 *                         baseline), payment failure at day 15 → suspension
 *                         PREPARED and waiting on a human; also carries an
 *                         UNCONSENTED transcript to prove the 2.2.4 refusal
 *
 * Idempotent for these four slugs + staff user + billing rows. Run AFTER
 * db:seed. Usage: npm run db:seed:fleet
 */
import { Client } from "pg";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

type Json = Record<string, unknown> | unknown[];
const j = (v: Json) => JSON.stringify(v);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const RECORDING_CONSENT_TEXT =
  "I agree that my onboarding call with Curbside Sites will be recorded and transcribed. The recording and transcript will be processed by Anthropic (an AI service) and used to generate marketing content in my business's voice for the life of my account. The recording and transcript are retained while my account is active. I can withdraw this consent at any time by emailing hello@curbsidesites.com or asking in my site portal; withdrawal deletes the recording and the transcript.";
const TERMS_TEXT =
  "I agree to the Curbside Sites terms of service and authorize Curbside Sites to build and host a website for my business.";

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 64).toString("base64")}`;
}

const INTEGRATION_KEYS: [string, string][] = [
  ["reviews_google", "client"], ["reviews_yelp", "client"], ["instagram", "client"],
  ["analytics", "curbside"], ["email", "curbside"], ["newsletter", "curbside"],
  ["payments", "client"], ["booking", "curbside"], ["quote_assistant", "curbside"],
  ["call_tracking", "curbside"], ["change_request_ai", "curbside"],
];

interface FleetTenant {
  slug: string; name: string; status: string; plan: string; owner: string;
  industry: string; city: string; phone: [string, string]; street: string; postal: string;
  tokens: Json; pairing: string; services: [string, string, string][];
  brandGate: "approved" | "proposed";
}

async function insertFleetTenant(db: Client, t: FleetTenant): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO tenants (slug, business_name, status, plan_tier, features, owner_email)
     VALUES ($1, $2, $3, $4, '{}', $5) RETURNING id`,
    [t.slug, t.name, t.status, t.plan, t.owner]
  );
  const id = rows[0].id as string;

  await db.query(
    `INSERT INTO business_profile (tenant_id, nap, hours, socials, service_area, schema_subtype, about, voice_notes)
     VALUES ($1, $2, $3, '{}', $4, $5, $6, $6)`,
    [
      id,
      j({ name: t.name, street: t.street, city: t.city, region: "CA", postal: t.postal, phone_display: t.phone[0], phone_tel: t.phone[1] }),
      j({ mon: [["08:00", "17:00"]], tue: [["08:00", "17:00"]], wed: [["08:00", "17:00"]], thu: [["08:00", "17:00"]], fri: [["08:00", "17:00"]], sat: [], sun: [] }),
      [t.city],
      t.industry,
      `${t.name} has served ${t.city} for years. Straight talk, fair prices, work we stand behind.`,
    ]
  );
  await db.query("INSERT INTO brand (tenant_id, tokens, font_pairing_key) VALUES ($1, $2, $3)", [id, j(t.tokens), t.pairing]);
  await db.query(
    `INSERT INTO brand_proposals (tenant_id, tokens, font_pairing_key, notes, status, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, j(t.tokens), t.pairing, j({ source: "industry preset (seed)", texture_notes: "seeded demo proposal", do_not_do: ["nothing generic"] }), t.brandGate, t.brandGate === "approved" ? daysAgo(30) : null]
  );
  for (let i = 0; i < t.services.length; i++) {
    const [slug, name, blurb] = t.services[i];
    await db.query("INSERT INTO services (tenant_id, slug, name, blurb, sort_order) VALUES ($1,$2,$3,$4,$5)", [id, slug, name, blurb, i]);
  }
  await db.query(
    `INSERT INTO images (tenant_id, slot_id, purpose, aspect, alt) VALUES
     ($1,'hero','hero background','16:9',$2), ($1,'about-shop','about section','4:3',$3)`,
    [id, `${t.name} at work`, `The ${t.name} shop`]
  );
  for (const [key, owner] of INTEGRATION_KEYS) {
    await db.query(
      `INSERT INTO integrations (tenant_id, key, mode, kv_secret_ref, key_owner)
       VALUES ($1, $2, 'demo', $3, $4)`,
      [id, key, `tenant-${t.slug}-${key.replace(/_/g, "-")}-key`, owner]
    );
  }
  await db.query(
    "INSERT INTO consents (tenant_id, kind, source, consent_text) VALUES ($1, 'terms_of_service', 'intake_form', $2)",
    [id, TERMS_TEXT]
  );
  return id;
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await db.connect();
  try {
    await db.query("BEGIN");

    // --- staff user (D16) ---------------------------------------------------
    const staffEmail = (process.env.STAFF_ADMIN_EMAIL ?? "jason@curbsidesites.com").toLowerCase();
    const staffPassword = process.env.STAFF_ADMIN_PASSWORD ?? randomBytes(9).toString("base64url");
    await db.query(
      `INSERT INTO staff_users (email, name, role, password_hash)
       VALUES ($1, 'Jason', 'admin', $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = $2`,
      [staffEmail, hashPassword(staffPassword)]
    );

    // --- billing for the two Session-1 tenants ------------------------------
    const existing = await db.query(
      "SELECT id, slug, plan_tier FROM tenants WHERE slug IN ('iron-ridge-offroad','delta-marine-service')"
    );
    for (const t of existing.rows) {
      const mrr = t.plan_tier === "curb_pro" ? 149900 : t.plan_tier === "curb_plus" ? 74900 : 19900;
      await db.query(
        `INSERT INTO billing (tenant_id, stripe_customer_id, stripe_subscription_id, status, plan_price_id, mrr_cents)
         VALUES ($1, $2, $3, 'active', $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET status = 'active', mrr_cents = $5, updated_at = now()`,
        [t.id, `cus_demo_${t.slug.slice(0, 12)}`, `sub_demo_${t.slug.slice(0, 12)}`, `price_${t.plan_tier}`, mrr]
      );
    }

    // --- the four fleet tenants (idempotent) ---------------------------------
    await db.query(
      "DELETE FROM tenants WHERE slug IN ('high-desert-fence','sunrise-pool-care','valley-heating-air','bayside-detailing')"
    );

    // 1. DRAFT mid-onboarding: the brand gate has something to decide.
    const fence = await insertFleetTenant(db, {
      slug: "high-desert-fence", name: "High Desert Fence & Weld", status: "draft", plan: "curb",
      owner: "owner@highdesertfence.test", industry: "GeneralContractor", city: "Victorville",
      phone: ["(760) 555-0177", "+17605550177"], street: "14210 Amargosa Rd", postal: "92392",
      tokens: { brand: "#525b63", brand_dark: "#14161a", surface: "#15130f", surface_raised: "#201d18", ink: "#f3efe8", ink_muted: "#b5aea2", edge: "#3b362d", accent: "#d97706" },
      pairing: "impact", brandGate: "proposed",
      services: [
        ["chain-link", "Chain Link & Security Fencing", "Commercial-grade chain link, installed straight."],
        ["custom-gates", "Custom Gates & Fabrication", "Welded steel gates built in-house."],
      ],
    });
    await db.query(
      "INSERT INTO consents (tenant_id, kind, source, consent_text) VALUES ($1, 'call_recording_ai', 'intake_form', $2)",
      [fence, RECORDING_CONSENT_TEXT]
    );
    await db.query("INSERT INTO onboarding_calls (tenant_id, scheduled_at) VALUES ($1, $2)", [fence, daysAgo(-1)]);
    await db.query(
      "INSERT INTO intake_submissions (tenant_id, payload, ip) VALUES ($1, $2, '127.0.0.1')",
      [fence, j({ business_name: "High Desert Fence & Weld", industry: "fencing", addons: ["seo"], consent_recording: true, seeded: true })]
    );

    // 2. Live with ONE FAILING INTEGRATION (D11 failure mode on display).
    const pool = await insertFleetTenant(db, {
      slug: "sunrise-pool-care", name: "Sunrise Pool Care", status: "live", plan: "curb_plus",
      owner: "owner@sunrisepoolcare.test", industry: "LocalBusiness", city: "Apple Valley",
      phone: ["(760) 555-0161", "+17605550161"], street: "18550 US-18", postal: "92307",
      tokens: { brand: "#0369a1", brand_dark: "#0c4a6e", surface: "#fbfaf7", surface_raised: "#efeeea", ink: "#1a2430", ink_muted: "#4c5a66", edge: "#cfd4d2", accent: "#b45309" },
      pairing: "modernist", brandGate: "approved",
      services: [
        ["weekly-service", "Weekly Pool Service", "Chemicals, brushing, skimming — every week, photo-logged."],
        ["equipment-repair", "Equipment Repair", "Pumps, filters, heaters, salt systems."],
      ],
    });
    // reviews_google flagged LIVE with config + a (deliberately invalid) key in
    // env → runtime failure → demo fallback; last_error_at pre-set so the
    // dashboard shows the error state even before the first render.
    await db.query(
      `UPDATE integrations SET mode = 'live', config = $2, last_error_at = $3, last_error = 'Google Places 403: API key invalid'
        WHERE tenant_id = $1 AND key = 'reviews_google'`,
      [pool, j({ place_id: "ChIJdemo-sunrise-pool" }), daysAgo(1)]
    );
    // A secret expiring soon → Part 3 expiry warning has something to warn about.
    await db.query(
      `UPDATE integrations SET secret_expires_at = $2, rotation_days = 60 WHERE tenant_id = $1 AND key = 'instagram'`,
      [pool, daysAgo(-12)]
    );
    await db.query(
      `INSERT INTO billing (tenant_id, stripe_customer_id, status, plan_price_id, mrr_cents)
       VALUES ($1, 'cus_demo_sunrise', 'active', 'price_curb_plus', 74900)`,
      [pool]
    );
    await db.query(
      `INSERT INTO leads (tenant_id, name, contact, message, source, created_at) VALUES
       ($1, 'Rita Alvarez', '{"phone":"(760) 555-0102"}', 'Green pool after vacation, need help this week.', 'organic', $2),
       ($1, 'Mark Chen', '{"email":"mchen@example.com"}', 'Quote for weekly service, 15k gal pool.', 'gbp', $3)`,
      [pool, daysAgo(2), daysAgo(5)]
    );

    // 3. SUSPENDED for non-payment, full dunning history behind it.
    const hvac = await insertFleetTenant(db, {
      slug: "valley-heating-air", name: "Valley Heating & Air", status: "suspended", plan: "curb",
      owner: "owner@valleyheatingair.test", industry: "HVACBusiness", city: "Hesperia",
      phone: ["(760) 555-0149", "+17605550149"], street: "9038 I Ave", postal: "92345",
      tokens: { brand: "#1d4ed8", brand_dark: "#172554", surface: "#fbfaf7", surface_raised: "#efeeea", ink: "#1a2430", ink_muted: "#4c5a66", edge: "#cfd4d2", accent: "#b45309" },
      pairing: "modernist", brandGate: "approved",
      services: [["ac-repair", "AC Repair", "Same-week diagnostics, honest quotes."]],
    });
    await db.query(
      `INSERT INTO billing (tenant_id, stripe_customer_id, status, plan_price_id, mrr_cents)
       VALUES ($1, 'cus_demo_valley', 'unpaid', 'price_curb', 19900)`,
      [hvac]
    );
    await db.query(
      `INSERT INTO payment_failures (tenant_id, stripe_invoice_id, amount_cents, first_failed_at, last_failed_at, retries, warnings, status)
       VALUES ($1, 'in_demo_valley_01', 19900, $2, $3, 4, $4, 'suspended')`,
      [hvac, daysAgo(41), daysAgo(20), j([{ day: 3, sent_at: daysAgo(38) }, { day: 7, sent_at: daysAgo(34) }, { day: 14, sent_at: daysAgo(27) }])]
    );
    await db.query(
      `INSERT INTO pending_actions (tenant_id, kind, reason, status, decided_at, note)
       VALUES ($1, 'suspend_tenant', 'Non-payment: $199.00 outstanding for 20 days, 3 warnings sent.', 'approved', $2, 'confirmed by phone attempt first')`,
      [hvac, daysAgo(19)]
    );
    await db.query(
      `INSERT INTO audit_log (actor, tenant_id, action, detail) VALUES
       ('system', $1, 'dunning.warning_sent', '{"day":14}'),
       ($2, $1, 'tenant.suspended', '{"via":"pending_action"}')`,
      [hvac, staffEmail]
    );

    // 4. Live with a BASELINE then silence (the Part 5 alarm's reason to exist)
    //    + a day-15 payment failure waiting on a human + an UNCONSENTED
    //    transcript (proves the 2.2.4 refusal without touching real tenants).
    const detail = await insertFleetTenant(db, {
      slug: "bayside-detailing", name: "Bayside Mobile Detailing", status: "live", plan: "curb",
      owner: "owner@baysidedetailing.test", industry: "LocalBusiness", city: "Discovery Bay",
      phone: ["(925) 555-0188", "+19255550188"], street: "1580 Discovery Bay Blvd", postal: "94505",
      tokens: { brand: "#0e4e6e", brand_dark: "#0a2b3d", surface: "#fbfaf7", surface_raised: "#efeeea", ink: "#132a3a", ink_muted: "#48606f", edge: "#c6d1d6", accent: "#9a3412" },
      pairing: "nautical", brandGate: "approved",
      services: [["boat-detailing", "Boat & RV Detailing", "We come to your dock or driveway."]],
    });
    await db.query(
      `INSERT INTO leads (tenant_id, name, contact, message, source, created_at) VALUES
       ($1, 'Old Baseline Lead', '{"phone":"(925) 555-0100"}', 'Detail before the season?', 'organic', $2),
       ($1, 'Another Old Lead', '{"email":"old@example.com"}', 'Oxidation removal quote.', 'direct', $3)`,
      [detail, daysAgo(45), daysAgo(38)]
    );
    await db.query(
      `INSERT INTO billing (tenant_id, stripe_customer_id, status, plan_price_id, mrr_cents)
       VALUES ($1, 'cus_demo_bayside', 'past_due', 'price_curb', 19900)`,
      [detail]
    );
    await db.query(
      `INSERT INTO payment_failures (tenant_id, stripe_invoice_id, amount_cents, first_failed_at, last_failed_at, retries, warnings, status)
       VALUES ($1, 'in_demo_bayside_01', 19900, $2, $3, 3, $4, 'pending_suspension')`,
      [detail, daysAgo(15), daysAgo(2), j([{ day: 3, sent_at: daysAgo(12) }, { day: 7, sent_at: daysAgo(8) }, { day: 14, sent_at: daysAgo(1) }])]
    );
    await db.query(
      `INSERT INTO pending_actions (tenant_id, kind, reason, payload)
       VALUES ($1, 'suspend_tenant', 'Non-payment: $199.00 outstanding for 15 days, 3 warnings sent.', '{}')`,
      [detail]
    );
    // Unconsented transcript: NO call_recording_ai consent row exists, and
    // verbal_consent is false. Content seeding must refuse (Part 12.4).
    await db.query(
      `INSERT INTO transcripts (tenant_id, body, verbal_consent)
       VALUES ($1, 'SEEDED UNCONSENTED TRANSCRIPT — exists to prove the pipeline refuses it. If the content pipeline ever uses this text, that is a §632-shaped bug.', false)`,
      [detail]
    );
    // An escalated + an urgent change request so the queue has work.
    await db.query(
      `INSERT INTO change_requests (tenant_id, raw_message, status, urgent, created_at) VALUES
       ($1, 'Can you add a page for ceramic coating packages with before/after photos and its own pricing table?', 'escalated', false, $2),
       ($1, 'URGENT - phone number on the site rings my OLD cell. Customers are getting my ex-business partner!!', 'escalated', true, $3)`,
      [detail, daysAgo(4), daysAgo(0.2)]
    );

    await db.query("COMMIT");
    console.log("Fleet seeded: high-desert-fence (draft), sunrise-pool-care (failing integration),");
    console.log("              valley-heating-air (suspended), bayside-detailing (zero-subs + pending suspension)");
    console.log("");
    console.log(`Staff login → http://admin.localhost:3000/login`);
    console.log(`  email:    ${staffEmail}`);
    console.log(`  password: ${staffPassword}${process.env.STAFF_ADMIN_PASSWORD ? " (from STAFF_ADMIN_PASSWORD)" : "  ← GENERATED, save it now"}`);
    console.log("  MFA: enrolls on first login (TOTP, any authenticator app)");
    console.log("");
    console.log("The failing-integration demo needs this in .env.local:");
    console.log("  SECRET_tenant-sunrise-pool-care-reviews-google-key=invalid-key-for-failure-demo");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
