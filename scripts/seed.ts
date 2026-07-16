/**
 * Seed: two realistic demo tenants (D5 — demo content IS the sales asset).
 *
 *   iron-ridge-offroad   — off-road shop, Victorville CA. Dark, mechanical.
 *   delta-marine-service — boat service, Discovery Bay CA. Light, nautical.
 *
 * Two deliberately different brands proving one codebase renders both.
 * Localized on purpose: Johnson Valley, El Mirage, the California Delta,
 * real-ish 760/925 numbers, the vehicles these customers actually drive.
 *
 * Idempotent: re-running deletes and re-creates these two slugs only.
 * Runs as curbside_owner. Usage: npm run db:seed
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

import { sourceForTenant } from "./lib/image-sourcing";

type Json = Record<string, unknown> | unknown[];
const j = (v: Json) => JSON.stringify(v);

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("DELETE FROM tenants WHERE slug IN ('iron-ridge-offroad','delta-marine-service')");
    await seedIronRidge(db);
    await seedDeltaMarine(db);
    await db.query("COMMIT");
    console.log("Seeded: iron-ridge-offroad, delta-marine-service");
    await bootstrapDemoImages(["iron-ridge-offroad", "delta-marine-service"]);
    console.log("Browse:  http://iron-ridge-offroad.localhost:3000  http://delta-marine-service.localhost:3000");
    console.log("Custom-domain rows (curl with Host header): ironridgeoffroad.test, deltamarineservice.test");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}

/**
 * A demo site with bare placeholders undersells the product, so seeding
 * finishes by sourcing stock images through the Part 10 pipeline and
 * auto-applying the top pick per slot (candidates cache under
 * .data/image-candidates/, so re-seeding is fast and works offline).
 * Non-fatal by design: no network → branded SVG placeholders keep serving.
 * The contact-sheet review is still required before any tenant goes live.
 */
async function bootstrapDemoImages(slugs: string[]) {
  if (process.env.CI || process.env.SKIP_IMAGE_SOURCING) {
    console.log("Image sourcing skipped (CI/SKIP_IMAGE_SOURCING); branded placeholders serve.");
    return;
  }
  for (const slug of slugs) {
    try {
      await sourceForTenant(slug, { auto: true });
    } catch (e) {
      console.warn(
        `⚠ image sourcing for ${slug} failed (${e instanceof Error ? e.message : e}); ` +
          `branded placeholders keep serving. Retry: npm run images:source ${slug} -- --auto`
      );
    }
  }
}

async function insertTenant(db: Client, t: {
  slug: string; name: string; plan: string; features: Json; owner: string; hostname: string;
}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO tenants (slug, business_name, status, plan_tier, features, owner_email)
     VALUES ($1, $2, 'live', $3, $4, $5) RETURNING id`,
    [t.slug, t.name, t.plan, j(t.features), t.owner]
  );
  const id = rows[0].id as string;
  await db.query(
    "INSERT INTO domains (tenant_id, hostname, is_primary, verified_at) VALUES ($1, $2, true, now())",
    [id, t.hostname]
  );
  return id;
}

const INTEGRATION_KEYS: [key: string, owner: string, config: Json][] = [
  ["reviews_google", "client", {}],
  ["reviews_yelp", "client", {}],
  ["instagram", "client", {}],
  ["analytics", "curbside", {}],
  ["email", "curbside", {}],
  ["newsletter", "curbside", {}],
  ["payments", "client", {}],
  ["booking", "curbside", {}],
  ["quote_assistant", "curbside", {}],
  ["call_tracking", "curbside", {}],
  ["change_request_ai", "curbside", {}],
  // Growth plane (Session 3)
  ["gbp", "client", {}],
  ["rank_tracking", "curbside", {}],
];

async function insertIntegrations(db: Client, tenantId: string, slug: string) {
  for (const [key, owner, config] of INTEGRATION_KEYS) {
    await db.query(
      `INSERT INTO integrations (tenant_id, key, mode, config, kv_secret_ref, key_owner)
       VALUES ($1, $2, 'demo', $3, $4, $5)`,
      [tenantId, key, j(config), `tenant-${slug}-${key.replace(/_/g, "-")}-key`, owner]
    );
  }
}

// ===========================================================================
// TENANT A — IRON RIDGE OFFROAD (Victorville, CA)
// ===========================================================================

async function seedIronRidge(db: Client) {
  const id = await insertTenant(db, {
    slug: "iron-ridge-offroad",
    name: "Iron Ridge Offroad",
    plan: "curb_pro",
    features: { payments: true, quote_assistant: true, booking: false, call_tracking: false },
    owner: "owner@ironridgeoffroad.test",
    hostname: "ironridgeoffroad.test",
  });

  await db.query(
    `INSERT INTO business_profile (tenant_id, nap, hours, geo, socials, service_area, schema_subtype, tagline, about)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      j({
        name: "Iron Ridge Offroad",
        street: "22801 Mojave Ct",
        city: "Victorville",
        region: "CA",
        postal: "92394",
        phone_display: "(760) 555-0134",
        phone_tel: "+17605550134",
      }),
      j({
        mon: [["08:00", "17:00"]], tue: [["08:00", "17:00"]], wed: [["08:00", "17:00"]],
        thu: [["08:00", "17:00"]], fri: [["08:00", "17:00"]], sat: [["09:00", "14:00"]], sun: [],
      }),
      j({ lat: 34.5362, lng: -117.2928 }),
      j({ instagram: "@ironridgeoffroad", facebook: "https://facebook.com/ironridgeoffroad", yelp_url: "https://yelp.com/biz/iron-ridge-offroad-victorville" }),
      ["Victorville", "Apple Valley", "Hesperia", "Barstow", "the High Desert"],
      "AutoRepair",
      "Built for the dirt. Backed by the miles.",
      [
        "Iron Ridge started in a two-bay shop off Mojave Court in 2014, building rigs for the same trails we run ourselves — Johnson Valley, El Mirage, the backside of Big Bear. Ten years later it's still the same deal: we build trucks we'd put our own families in, and we stand behind every bolt.",
        "No sales guys, no upsell scripts. You talk to the tech who does the work. If a leveling kit does what you need, we won't sell you a long-travel kit — and when you're ready for 37s and a regear, we'll tell you exactly what that really costs to do right.",
      ].join("\n\n"),
    ]
  );

  await db.query(
    "INSERT INTO brand (tenant_id, tokens, font_pairing_key) VALUES ($1, $2, 'industrial')",
    [
      id,
      j({
        brand: "#9a3412",
        brand_dark: "#100d0a",
        surface: "#161310",
        surface_raised: "#211d18",
        ink: "#f4efe8",
        ink_muted: "#b7afa3",
        edge: "#3d372e",
        accent: "#d97706",
      }),
    ]
  );

  const services: [string, string, string, string][] = [
    ["lift-kits", "Lift & Leveling Kits",
      "From a 2-inch level to long-travel — installed, aligned, and warrantied.",
      "We install what we'd run: Icon, King, Fox, BDS. Every install includes a post-install alignment and a 500-mile retorque, free.\n\n**What it runs:** a leveling kit with alignment usually lands between $450 and $900 installed. Full lift systems vary with the platform — call with your year and model and we'll quote it straight."],
    ["wheels-tires", "Wheels & Tires",
      "Mounted, balanced, and matched to how you actually drive.",
      "35s on stock suspension? Sometimes. We'll tell you when it works and when it's a rubbing, regearing headache. We stock Method, Fuel, and KMC, and mount anything from a highway AT to a full sticky crawler tire."],
    ["suspension", "Suspension & Long Travel",
      "Coilovers, bypasses, geometry correction — desert-proven setups.",
      "The High Desert eats cheap suspension. We build setups that survive whoops at speed: proper spring rates for your actual load, tuned valving, and geometry that keeps the truck predictable when it gets rough."],
    ["fab-armor", "Fabrication & Armor",
      "Sliders, skids, bumpers, chase racks — designed and welded in-house.",
      "In-house plate and tube work. Rock sliders that hold a truck's weight on a boulder, skids that actually cover the cat, bumpers sized for a Warn without the bolt-on look."],
    ["regear-lockers", "Regearing & Lockers",
      "Get your power back after big tires. Gears, lockers, chromoly shafts.",
      "37s on stock gears is a slug. We regear Dana, AAM, and Toyota axles, install ARB and Eaton lockers, and set patterns the old-school way — marked, checked, and backlash-verified, not just torqued and shipped."],
  ];
  for (let i = 0; i < services.length; i++) {
    await db.query(
      "INSERT INTO services (tenant_id, slug, name, blurb, body, sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, ...services[i], i]
    );
  }

  const sections: [string, string, number, Json][] = [
    ["home", "hero", 0, { headline: "Built for the dirt.", sub: "Lift kits, long travel, armor, and regears — Victorville's off-road shop since 2014." }],
    ["home", "stats-band", 1, { stats: [
      { value: "10+", label: "Years in the High Desert" },
      { value: "2,400+", label: "Rigs built and serviced" },
      { value: "500 mi", label: "Free retorque on every lift" },
      { value: "KOH", label: "We wrench where we race" },
    ] }],
    ["home", "services-grid", 2, { heading: "What we build" }],
    ["home", "about-story", 3, {}],
    ["home", "gallery", 4, { heading: "Out of the bay" }],
    ["home", "reviews", 5, { heading: "Word around the desert" }],
    ["home", "instagram-strip", 6, {}],
    ["home", "faq", 7, { items: [
      { q: "Do you work on Jeeps or just trucks?", a: "Both, plus SxSs. Wranglers, Gladiators, Tacomas, Raptors, full-size GM and Ram — if it leaves pavement, we work on it." },
      { q: "Can I supply my own parts?", a: "Usually yes, with a straight caveat: we warranty our labor on customer parts, not the parts themselves. Buy through us and both are covered." },
      { q: "How long does a lift install take?", a: "A leveling kit is same-day. A full lift with new wheels and tires is typically 1–2 days including alignment. Long-travel builds get scheduled as projects." },
      { q: "Do you do financing?", a: "For larger builds we can split the job into staged phases that each make sense on their own. Ask when you get your quote." },
    ] }],
    ["home", "cta-band", 8, { headline: "Let's build your rig.", sub: "Straight answers and a real number — call or send the details." }],
    ["services", "faq", 0, { heading: "Before you ask", items: [
      { q: "Will a lift void my factory warranty?", a: "Not by itself — dealers must show a modification caused a specific failure (Magnuson-Moss). We install to spec and document everything, which keeps dealer conversations short." },
      { q: "Do you do alignments in-house?", a: "Yes — every suspension job leaves on our rack, set to spec for its actual ride height." },
    ] }],
    ["services", "cta-band", 1, { headline: "Ready for a real quote?" }],
    ["about", "about-story", 0, { heading: "The shop" }],
    ["about", "stats-band", 1, { stats: [
      { value: "6", label: "Bays" },
      { value: "4", label: "Certified techs" },
      { value: "1", label: "Question we won't dodge: what it really costs" },
    ] }],
    ["about", "cta-band", 2, {}],
    ["gallery", "gallery", 0, { heading: "Recent builds", limit: 8 }],
    ["gallery", "instagram-strip", 1, {}],
    ["gallery", "cta-band", 2, { headline: "Want yours in this gallery?" }],
    ["contact", "contact-block", 0, {}],
    ["contact", "quote-form", 1, { vehicle_label: "Vehicle", vehicle_placeholder: "e.g. 2021 Tacoma TRD Off-Road" }],
    ["contact", "payments-callout", 2, {}],
    ["contact", "quote-assistant", 3, { heading: "Instant ballpark" }],
    ["contact", "newsletter", 4, { heading: "Desert notes", sub: "Trail conditions, event weekends, and shop specials. Monthly-ish." }],
  ];
  for (const [page, name, order, props] of sections) {
    await db.query(
      "INSERT INTO sections (tenant_id, page, section_name, sort_order, props) VALUES ($1,$2,$3,$4,$5)",
      [id, page, name, order, j(props)]
    );
  }

  // Queries are tuned for what CC stock indexes actually contain (Openverse
  // search is AND-ish and thin on shop interiors — scenic/regional subjects
  // and macro textures source reliably; "workbench" style queries do not).
  const images: [string, string, string, string, string][] = [
    ["hero", "hero background", "lifted truck desert dusk silhouette mojave", "16:9", "Kicking up dust crossing the El Mirage lakebed"],
    ["about-shop", "about section", "mojave desert road joshua tree", "4:3", "Open desert two-lane heading toward the ranges outside Victorville"],
    ["service-lift-kits", "services page", "truck suspension lift install shop", "4:3", "Lifted 2500HD on 35s at golden hour"],
    ["service-fab-armor", "services page", "welding rock sliders fabrication", "4:3", "Weld bead detail on plate steel"],
    ["gallery-1", "gallery", "lifted jeep rock crawling johnson valley", "2:1", "Mud-caked rig out on the lakebed flats"],
    ["gallery-2", "gallery", "prerunner truck whoops desert", "1:1", "Blacked-out prerunner build in the fab bay"],
    ["gallery-3", "gallery", "welding sparks metal", "1:1", "Repair welding under a customer's F-250"],
    ["gallery-4", "gallery", "jeep camping desert tent", "1:1", "High-desert trail country under big clouds"],
    ["gallery-5", "gallery", "oceano dunes california sand", "1:1", "Wind-rippled dunes at Oceano"],
    ["gallery-6", "gallery", "truck wheel workshop tire", "1:1", "Fresh 35s ready to mount"],
  ];
  for (const [slot, purpose, query, aspect, alt] of images) {
    await db.query(
      "INSERT INTO images (tenant_id, slot_id, purpose, search_query, aspect, alt) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, slot, purpose.includes("gallery") ? "gallery" : purpose, query, aspect, alt]
    );
  }

  const reviews: [string, string, number, string, string][] = [
    ["google", "Marcus T.", 5, "Took my Tacoma in for a 3-inch lift and 33s. They talked me OUT of the more expensive kit because of how I actually drive. Alignment was dead-on and they retorqued everything free at 500 miles. This is the shop.", "2026-04-18"],
    ["google", "Danielle R.", 5, "My husband's F-250 needed a regear after we went to 37s. Other shops quoted weeks. Iron Ridge had it done in four days and the truck finally drives like it should. Honest people.", "2026-05-02"],
    ["yelp", "Victor M.", 4, "Quality work on my JL — sliders and skids, all welded in-house and they look factory. Only reason for 4 stars is they're booked out, but that tells you something.", "2026-03-27"],
    ["google", "Cody B.", 5, "These guys race at KOH. They set up my prerunner's suspension for El Mirage and it's a different truck at speed. Worth every penny.", "2026-05-21"],
    ["google", "Alyssa H.", 5, "Called with a hundred questions about leveling my Ram 2500 before towing season. Tech walked me through everything, no pressure. Booked on the spot.", "2026-06-08"],
    ["yelp", "Ray S.", 5, "Brought in an SxS with blown-out shocks before a Glamis trip. They squeezed me in, revalved everything, and it survived the dunes all weekend. High Desert gem.", "2026-02-14"],
  ];
  for (const [source, author, rating, body, date] of reviews) {
    await db.query(
      `INSERT INTO reviews (tenant_id, source, author, rating, body, published_at, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [id, source, author, rating, body, `${date}T12:00:00-08:00`]
    );
  }

  const leads: [string, Json, string, string, string, string, string][] = [
    ["Jake Morrison", { phone: "(760) 555-0198", preferred: "text" }, "Lift & Leveling Kits", "2019 F-250 Platinum", "Looking at a 2.5 leveling kit and 35s before towing season. What's the damage all-in with alignment?", "organic", "new"],
    ["Brianna Cole", { email: "brianna.c@example.com", phone: "(760) 555-0142", preferred: "phone" }, "Regearing & Lockers", "2021 Jeep Wrangler JL", "Went to 37s and highway RPM is killing me. Thinking 4.88s and a rear locker. When could you look at it?", "gbp", "contacted"],
    ["Tom Nguyen", { phone: "(442) 555-0117", preferred: "phone" }, "Suspension & Long Travel", "2020 Tacoma TRD OR", "Kings or Icons for mostly fire roads + a few desert trips a year? Want it done before August.", "instagram", "quoted"],
    ["Denise Alvarez", { email: "denise.alv@example.com", preferred: "email" }, "Fabrication & Armor", "2023 Ram 2500", "Need sliders and a full skid package. Truck is my daily so looking for something clean, not race-truck loud.", "direct", "won"],
  ];
  for (const [name, contact, service, vehicle, message, source, status] of leads) {
    await db.query(
      `INSERT INTO leads (tenant_id, name, contact, service, vehicle, message, source, status, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
      [id, name, j(contact), service, vehicle, message, source, status]
    );
  }

  await db.query(
    "INSERT INTO subscribers (tenant_id, email, is_demo) VALUES ($1,'jake.m@example.com',true),($1,'desertrat92@example.com',true),($1,'brianna.c@example.com',true)",
    [id]
  );

  const posts: [string, string, string, string, string[], string][] = [
    [
      "leveling-kit-vs-lift-kit",
      "Leveling kit vs. lift kit: which one does your truck actually need?",
      "The honest breakdown we give every customer — what a leveling kit fixes, what a lift kit changes, and the hidden costs nobody quotes you up front.",
      "2026-05-12",
      ["suspension", "buyers-guide"],
      `Every week someone calls the shop asking for "a lift" when what they actually need is a $450 leveling kit — and now and then it's the other way around. Here's the same talk we give at the counter.

## What a leveling kit does

Trucks ship nose-down from the factory — usually 1 to 2 inches of "rake" so the truck sits level under a load. A leveling kit raises just the front to erase that rake. That's it. It's the right call if you want:

- Room for a moderately bigger tire (33s on most half-tons)
- A level stance without changing how the truck tows
- The cheapest path that doesn't wreck ride quality

A quality leveling kit installed with an alignment typically runs **$450–$900** at our shop, depending on platform.

## What a lift kit changes

A real lift changes the suspension: springs, shocks, sometimes control arms and geometry correction. You're buying room for 35s and up, more travel, and a setup matched to actual off-road use. You're also buying consequences:

- **Regearing.** 35s and bigger eat your factory gearing. Budget for it or live with a sluggish truck.
- **Driveline angles.** Cheap kits skip the correction parts. That's the vibration you feel at 70.
- **Alignment and retorque.** Non-negotiable. We include both.

## The rule of thumb

If your truck mostly tows, hauls, and sees dirt roads a few times a year: level it, run a good AT tire, spend the savings on shocks. If you're chasing trails, whoops, or rocks on a schedule: lift it once, properly, with the supporting mods — doing it twice costs more than doing it right.

Not sure which you are? Call us at the shop with your year, model, and what a normal month looks like for the truck. Straight answer, real number, no pressure.`,
    ],
    [
      "king-of-the-hammers-prep",
      "Getting your rig (and yourself) ready for a King of the Hammers week",
      "A High Desert shop's checklist for spectating or wheeling Johnson Valley during KOH — what breaks out there and what to do about it in January.",
      "2026-01-20",
      ["events", "trail-prep"],
      `Every February, Johnson Valley turns into the biggest off-road city on earth, and every February we get the same calls the week after: bent tie rods, cooked brakes, shredded sidewalls. Here's the prep list we run on our own rigs in January.

## The big three failures we see

1. **Steering.** Hammertown trails are boulder fields. Stock tie rods on 37s do not survive enthusiasm. If you're wheeling anything harder than Jackhammer's bypass lines, upgrade steering first.
2. **Cooling.** It's winter, but long low-speed crawls at high RPM cook marginal cooling systems. Flush it, pressure-test it, and check the fan clutch before you go.
3. **Sidewalls.** Sharp granite plus low pressure equals cut sidewalls. Carry two spares if you're running the lakebed camps — one if you never leave the spectator areas.

## Two weeks out

- Retorque everything you've touched this year. Then check it again after the first day out there.
- Repack wheel bearings if it's been more than a season.
- Fresh diff fluid if you've done any water crossings since the last change.

## What to bring

Recovery points front AND rear (rated, not the tie-down loops), a real first-aid kit, more water than feels reasonable, and tools that match your rig's fasteners — not "a toolbox."

We do a KOH-prep inspection every January: steering, cooling, bearings, brakes, fluids, and a torque pass, with a written punch list of anything marginal. Book it early — the two weeks before Hammers are our busiest of the year.`,
    ],
    [
      "35s-or-37s-regearing",
      "35s or 37s? The regearing math nobody shows you",
      "Bigger tires change your effective gearing more than you think. Here's the actual math, the symptoms of skipping it, and what a regear really costs.",
      "2026-03-05",
      ["drivetrain", "buyers-guide"],
      `Tires are the most popular mod in the High Desert and regearing is the least popular consequence. Here's the math we sketch on the counter whiteboard.

## The effective-ratio math

Your effective gearing scales with tire diameter. The formula:

**new effective ratio = axle ratio × (old tire diameter ÷ new tire diameter)**

Take a Tacoma on 3.91s moving from a 31-inch stock tire to 35s: 3.91 × (31 ÷ 35) = **3.46 effective**. You just geared your truck like a highway cruiser while adding rotating weight. That's why it feels gutless and hunts for gears on every grade.

## What the fix costs

To get back to (or better than) stock feel:

| Tire size | Typical target ratio | Ballpark installed (both axles) |
|---|---|---|
| 33s | 4.30–4.56 | $2,200–$2,800 |
| 35s | 4.56–4.88 | $2,400–$3,200 |
| 37s | 4.88–5.29 | $2,600–$3,600 |

Prices move with axle type and whether we're adding lockers while we're in there (smart — you're already paying for setup labor once).

## Symptoms you've skipped it

Constant downshifting on grades, transmission temps climbing while towing, 1–3 MPG lost beyond the tire weight penalty, and a dead spot off the line that no tune fixes.

## The honest recommendation

If you're going to 35s and the truck tows or climbs regularly: regear. If you're on 33s and mostly commute: you can live without it. 37s without a regear isn't a configuration — it's a countdown.

Send us your year, model, current ratio, and target tire through the quote form and we'll run your exact numbers.`,
    ],
  ];
  for (const [slug, title, description, date, tags, body] of posts) {
    await db.query(
      `INSERT INTO content (tenant_id, type, slug, frontmatter, body, published_at)
       VALUES ($1,'post',$2,$3,$4,$5)`,
      [id, slug, j({ title, description, date, author: "Iron Ridge Offroad", tags }), body, `${date}T12:00:00-08:00`]
    );
  }

  await insertIntegrations(db, id, "iron-ridge-offroad");
  console.log("  seeded iron-ridge-offroad");
}

// ===========================================================================
// TENANT B — DELTA MARINE SERVICE (Discovery Bay, CA)
// ===========================================================================

async function seedDeltaMarine(db: Client) {
  const id = await insertTenant(db, {
    slug: "delta-marine-service",
    name: "Delta Marine Service",
    plan: "curb_plus",
    features: { booking: true, quote_assistant: true, payments: false },
    owner: "owner@deltamarineservice.test",
    hostname: "deltamarineservice.test",
  });

  await db.query(
    `INSERT INTO business_profile (tenant_id, nap, hours, geo, socials, service_area, schema_subtype, tagline, about)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      j({
        name: "Delta Marine Service",
        street: "5310 Willow Lake Rd",
        city: "Discovery Bay",
        region: "CA",
        postal: "94505",
        phone_display: "(925) 555-0173",
        phone_tel: "+19255550173",
      }),
      j({
        mon: [], tue: [["08:30", "17:00"]], wed: [["08:30", "17:00"]], thu: [["08:30", "17:00"]],
        fri: [["08:30", "17:00"]], sat: [["08:00", "15:00"]], sun: [["09:00", "13:00"]],
      }),
      j({ lat: 37.9086, lng: -121.6003 }),
      j({ instagram: "@deltamarineservice", google_maps_url: "https://maps.google.com/?q=Delta+Marine+Service+Discovery+Bay" }),
      ["Discovery Bay", "Brentwood", "Bethel Island", "Oakley", "the California Delta"],
      "LocalBusiness",
      "Keep your weekends on the water.",
      [
        "Delta Marine Service has been keeping Discovery Bay and Delta boats running since 2011. Outboards, sterndrives, electronics, trailers — one shop, on the water, with a dock you can pull straight up to.",
        "Most of what we fix in July could have been a cheap winter appointment. That's why we're straight with you about maintenance: a $400 service in January beats a $4,000 tow-in on the Fourth of July weekend, and we'd rather see you on the water than in our shop.",
      ].join("\n\n"),
    ]
  );

  await db.query(
    "INSERT INTO brand (tenant_id, tokens, font_pairing_key) VALUES ($1, $2, 'nautical')",
    [
      id,
      j({
        brand: "#0e4e6e",
        brand_dark: "#0a2b3d",
        surface: "#fbfaf6",
        surface_raised: "#eef0ed",
        ink: "#132a3a",
        ink_muted: "#48606f",
        edge: "#c6d1d6",
        accent: "#9a3412",
      }),
    ]
  );

  const services: [string, string, string, string][] = [
    ["outboard-service", "Outboard Service & Repair",
      "Factory-trained service for Mercury, Yamaha, and Honda outboards.",
      "Annual services, impellers, lower-unit work, powerhead diagnostics. We service what the Delta actually runs: Mercury, Yamaha, Honda, and most Suzukis.\n\n**Typical annual service:** $250–$600 depending on engine hours and what we find. You get a written report either way."],
    ["sterndrive-service", "Sterndrive & Inboard",
      "MerCruiser and Volvo Penta service, bellows to risers.",
      "Bellows, gimbal bearings, manifolds and risers, outdrive rebuilds. Saltwater-cooled risers in the Delta's brackish water need eyes on them every other season — we photograph everything and show you before we replace anything."],
    ["electronics", "Marine Electronics",
      "Fish finders, GPS, radios, and full helm refits — installed clean.",
      "Garmin, Lowrance, Simrad. Transducer installs done right (no shoot-through-hull shortcuts on planing hulls), NMEA 2000 networks that actually network, and wiring you won't be ashamed of at the fuel dock."],
    ["gelcoat-detailing", "Gelcoat & Detailing",
      "Oxidation removal, wet sanding, ceramic — bring the shine back.",
      "Delta sun is hard on gelcoat. Compound and polish packages run roughly $40–$75 per foot depending on oxidation; ceramic on top makes next spring a rinse instead of a project."],
    ["trailer-service", "Trailer Service",
      "Bearings, brakes, bunks, and lights — before the launch ramp finds out.",
      "Half the 'boat problems' on the ramp are trailer problems. Bearing repacks, surge brake service, bunk and roller replacement, LED rewires. Do it in the off-season and skip the line."],
    ["layup-recommissioning", "Off-Season Layup & Spring Recommissioning",
      "Put it away right in fall, splash without surprises in spring.",
      "Our layup package: fuel stabilization, fogging or fuel-system prep, lower-unit service, battery maintenance plan, and a spring recommission with a water test. Boats that get this treatment start in April. The others meet our tow service."],
  ];
  for (let i = 0; i < services.length; i++) {
    await db.query(
      "INSERT INTO services (tenant_id, slug, name, blurb, body, sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, ...services[i], i]
    );
  }

  const sections: [string, string, number, Json][] = [
    ["home", "hero", 0, { headline: "Keep your weekends on the water.", sub: "Outboard, sterndrive, electronics, and trailer service — right here in Discovery Bay." }],
    ["home", "services-grid", 1, { heading: "What we service" }],
    ["home", "reviews", 2, { heading: "From the docks" }],
    ["home", "about-story", 3, { heading: "The shop on Willow Lake" }],
    ["home", "stats-band", 4, { stats: [
      { value: "14", label: "Seasons on the Delta" },
      { value: "3", label: "Factory-certified techs" },
      { value: "Dock", label: "Pull straight up — we're on the water" },
      { value: "48 hr", label: "Typical diagnostic turnaround" },
    ] }],
    ["home", "gallery", 5, { heading: "In the yard and on the water" }],
    ["home", "faq", 6, { items: [
      { q: "Do you come to my dock?", a: "Yes — mobile service covers Discovery Bay, Bethel Island, and most Delta marinas for jobs that don't need the shop. Haul-outs happen here on Willow Lake Rd." },
      { q: "Do I really need to winterize in California?", a: "Freeze damage is rare here, but layup isn't about freezing — it's fuel, corrosion, and batteries. Boats that sit untreated over winter are the ones that won't start in April." },
      { q: "How far out are you booked?", a: "Spring is our crunch — recommissions book 2–3 weeks out from March to May. Fall and winter, usually inside a week." },
      { q: "Do you sell parts?", a: "We stock common service parts (impellers, anodes, filters) for the engines the Delta runs and can order most anything else next-day." },
    ] }],
    ["home", "newsletter", 7, { heading: "Delta boater's notes", sub: "Seasonal checklists and water conditions. A few emails a year, all useful." }],
    ["home", "cta-band", 8, { headline: "Boat acting up?", sub: "Describe it over the phone — half the time we can tell you what it is before you trailer it." }],
    ["services", "cta-band", 0, { headline: "Get it handled before the season." }],
    ["about", "about-story", 0, { heading: "Who's touching your boat" }],
    ["about", "cta-band", 1, {}],
    ["gallery", "gallery", 0, { heading: "Recent work", limit: 8 }],
    ["gallery", "instagram-strip", 1, {}],
    ["gallery", "cta-band", 2, {}],
    ["contact", "contact-block", 0, {}],
    ["contact", "booking-teaser", 1, { heading: "Grab a service slot" }],
    ["contact", "quote-form", 2, { heading: "Request service", vehicle_label: "Boat / engine", vehicle_placeholder: "e.g. 2018 Bayliner VR5, Mercury 150" }],
    ["contact", "quote-assistant", 3, { heading: "Quick ballpark" }],
  ];
  for (const [page, name, order, props] of sections) {
    await db.query(
      "INSERT INTO sections (tenant_id, page, section_name, sort_order, props) VALUES ($1,$2,$3,$4,$5)",
      [id, page, name, order, j(props)]
    );
  }

  const images: [string, string, string, string, string][] = [
    ["hero", "hero background", "boat on delta water golden hour calm", "16:9", "A boat cutting across calm Delta water at golden hour"],
    ["about-shop", "about section", "marine service shop boat on lift dock", "4:3", "A sterndrive boat on the lift at the Willow Lake shop"],
    ["service-outboard-service", "services page", "outboard motor service mechanic", "4:3", "Annual service on a Yamaha 150 outboard"],
    ["service-electronics", "services page", "boat helm gps electronics install", "4:3", "A clean dual-display helm refit"],
    ["gallery-1", "gallery", "boat gelcoat polish restoration before after", "2:1", "Gelcoat restoration — oxidized to mirror finish"],
    ["gallery-2", "gallery", "outboard lower unit service bench", "1:1", "Lower-unit service on the bench"],
    ["gallery-3", "gallery", "boat trailer bearing service", "1:1", "Trailer hub and bearing service"],
    ["gallery-4", "gallery", "delta california waterway boat", "1:1", "Water-testing a recommissioned boat on the Delta"],
    ["gallery-5", "gallery", "marine electronics wiring nmea", "1:1", "NMEA 2000 backbone, labeled and loomed"],
    ["gallery-6", "gallery", "boat winterization shrink wrap yard", "1:1", "Off-season layup row in the yard"],
  ];
  for (const [slot, purpose, query, aspect, alt] of images) {
    await db.query(
      "INSERT INTO images (tenant_id, slot_id, purpose, search_query, aspect, alt) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, slot, purpose.includes("gallery") ? "gallery" : purpose, query, aspect, alt]
    );
  }

  const reviews: [string, string, number, string, string][] = [
    ["google", "Steve Callahan", 5, "My Merc 150 started surging mid-channel on a Saturday. They talked me through a check at the dock, had me bring it in Tuesday, and it was a $60 fuel line fitting — not the $1,200 'diagnostic special' another shop wanted. Honest shop.", "2026-05-16"],
    ["yelp", "Renee P.", 5, "They recommissioned our pontoon after it sat for two years. Gave us a written list of what it needed now vs. what could wait. It ran perfectly all Memorial Day weekend.", "2026-05-29"],
    ["google", "Gary Whitfield", 5, "Full electronics refit on my Ranger — two Garmins, new transducer, networked to the trolling motor. Wiring is cleaner than the factory did it. Fish don't stand a chance.", "2026-04-03"],
    ["google", "Monica S.", 4, "Gelcoat resto brought our 2009 Sea Ray back from chalk-white to actually shiny. Took a week longer than quoted (spring rush), but the result was worth it.", "2026-04-22"],
    ["yelp", "Duc T.", 5, "Trailer bearings gave out on the way to the ramp last year. This year I did their off-season trailer service. Guess whose season started on time.", "2026-03-11"],
    ["google", "Bill Mercer", 5, "Been bringing my boats here since 2015. Layup every fall, recommission every spring, zero on-water breakdowns in nine seasons. That's the whole review.", "2026-06-02"],
  ];
  for (const [source, author, rating, body, date] of reviews) {
    await db.query(
      `INSERT INTO reviews (tenant_id, source, author, rating, body, published_at, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [id, source, author, rating, body, `${date}T12:00:00-08:00`]
    );
  }

  const leads: [string, Json, string, string, string, string, string][] = [
    ["Kevin Bright", { phone: "(925) 555-0121", preferred: "phone" }, "Outboard Service & Repair", "2019 Tracker, Mercury 115", "Engine alarm at 4000 RPM this weekend. Overheat maybe? Need it looked at before the 24th.", "organic", "new"],
    ["Sandra Ortiz", { email: "sortiz@example.com", preferred: "email" }, "Off-Season Layup & Spring Recommissioning", "2016 Sea Ray SPX 210", "Boat sat all winter without layup (lesson learned). What does recommissioning run and how soon can you get it in?", "gbp", "contacted"],
    ["Phil Janssen", { phone: "(209) 555-0186", preferred: "text" }, "Marine Electronics", "2021 Ranger Z520", "Want a second graph at the bow networked to the Ultrex. Have the unit already, need install.", "referral", "quoted"],
    ["Carrie Lum", { email: "carrie.lum@example.com", phone: "(925) 555-0139", preferred: "phone" }, "Gelcoat & Detailing", "2009 Bayliner 175", "Hull is chalky and the previous owner let it go. Is it saveable or am I looking at paint?", "direct", "new"],
  ];
  for (const [name, contact, service, vehicle, message, source, status] of leads) {
    await db.query(
      `INSERT INTO leads (tenant_id, name, contact, service, vehicle, message, source, status, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
      [id, name, j(contact), service, vehicle, message, source, status]
    );
  }

  await db.query(
    "INSERT INTO subscribers (tenant_id, email, is_demo) VALUES ($1,'stevec@example.com',true),($1,'deltaboater@example.com',true)",
    [id]
  );

  const posts: [string, string, string, string, string[], string][] = [
    [
      "annual-outboard-service-checklist",
      "The annual outboard service checklist (and what happens when you skip it)",
      "What a real annual service covers on a Delta outboard, roughly what it costs, and the three failures we see every July from boats that skipped February.",
      "2026-02-10",
      ["maintenance", "outboards"],
      `Every July we meet the same boat: ran fine last season, sat all winter, died halfway to Mildred Island on its first hot weekend. Here's what an annual service actually covers and why each item is on the list.

## The checklist

- **Impeller and water pump.** Rubber impellers take a set when they sit, and the Delta's silty water wears them fast. This is the single most skipped item and the single most common cause of overheating. Replace on interval, not on failure.
- **Lower-unit oil.** We're checking for the milky look that means water intrusion past a seal. Caught in February, it's a seal. Caught in July, it can be a gearset.
- **Fuel system.** Today's fuel does not sit gracefully. Filters, lines, primer bulb condition, and a stabilizer plan for storage.
- **Spark plugs and compression check.** Plugs tell stories — a lean cylinder shows up here before it becomes a powerhead.
- **Anodes.** Brackish Delta water eats sacrificial anodes quietly. Cheap to replace, expensive to ignore.
- **Grease points, linkages, and the trim/tilt check** everyone forgets until the engine won't come up at the ramp.

## What it costs

At our shop a typical annual on a mid-size outboard runs **$250–$600** depending on engine hours and what we find. You get a written report of anything marginal either way — no mystery line items.

## When to book it

Not April. Everyone books April. January and February appointments get faster turnaround, and if we do find something big, you have months — not a holiday weekend — to deal with it.

Book through the request form or call the shop. Tell us the engine make, model, and roughly how many hours it ran last season.`,
    ],
    [
      "delta-offseason-layup",
      "Off-season layup on the Delta: it's not about freezing",
      "California boats skip 'winterization' because it doesn't freeze here — then meet dead batteries, varnished fuel, and corroded electrics in spring. Here's the layup that actually matters.",
      "2025-11-04",
      ["maintenance", "seasonal"],
      `Ask a Midwest boater about winterization and they'll talk about ice cracking engine blocks. That's (mostly) not our problem in the Delta. Our problem is what six idle months do to fuel, batteries, and metal — and it costs Delta boaters real money every spring.

## The three quiet killers

1. **Fuel.** Modern gasoline starts degrading in weeks. By March, untreated fuel has varnished carbs and injectors and the season starts with a $500 cleaning instead of a $12 bottle of stabilizer run through the system in November.
2. **Batteries.** A marine battery left connected and idle self-discharges, then sulfates, and by spring it holds half its capacity on a good day. A proper layup either puts it on a maintainer or disconnects and stores it.
3. **Corrosion.** Brackish water plus idle months equals green terminals, seized linkages, and anodes that quietly finished their job in October. A layup includes a corrosion-inhibitor pass and an anode check.

## What our layup package includes

Fuel stabilization run through the entire system, fogging or fuel-system prep appropriate to your engine, lower-unit service (so water intrusion gets caught in fall, not spring), battery plan, and a spring recommission with a real water test — not just "it started in the driveway."

## The math

The package costs a few hundred dollars. The average spring failure we fix on boats that skipped it — fuel-system cleaning plus a battery pair plus whatever the ramp discovered — runs well north of a thousand, and it always happens on the first good weekend.

Layup slots run October through December. Book before Thanksgiving and beat the rush.`,
    ],
    [
      "spring-recommissioning-checklist",
      "Splash-day checklist: recommissioning your boat for the Delta season",
      "The pre-launch checks that keep opening weekend from ending at the ramp — engine, trailer, safety gear, and the paperwork people forget.",
      "2026-03-18",
      ["seasonal", "checklists"],
      `Opening weekend on the Delta has two kinds of boats: the ones idling out of the marina, and the ones broken down ON the ramp teaching everyone patience. Here's how to be the first kind.

## Engine, before it touches water

- Reconnect and load-test batteries — not just "it cranks," an actual load test.
- Check the lower unit oil level and color.
- Inspect the impeller if it wasn't done at layup (or if you don't know when it was last done — that means it's due).
- Fresh fuel on top of stabilized fuel; if the tank sat untreated all winter, start with the filters.
- Run it on the muffs or better yet get a real water test before the family's aboard.

## Trailer, honestly the bigger risk

- Spin each hub and listen. Grinding or wobble = bearings before the first trip, not after.
- Check every light. Brackish launch dips kill trailer wiring.
- Tire date codes — trailer tires age out before they wear out.

## Safety gear audit

Life jackets for actual current passenger sizes (kids grew), fire extinguisher charge gauge, flares in date, horn works, throwable cushion aboard. The Coast Guard Auxiliary does free vessel checks — take them up on it.

## Paperwork

Registration current, and if you were born after January 1, 1988 (increasing yearly), your **California Boater Card** — required, and the fine is more than the card.

Want it all done in one appointment with a water test at our dock? That's our spring recommission. Book it in March and you're boating in April.`,
    ],
  ];
  for (const [slug, title, description, date, tags, body] of posts) {
    await db.query(
      `INSERT INTO content (tenant_id, type, slug, frontmatter, body, published_at)
       VALUES ($1,'post',$2,$3,$4,$5)`,
      [id, slug, j({ title, description, date, author: "Delta Marine Service", tags }), body, `${date}T12:00:00-08:00`]
    );
  }

  await insertIntegrations(db, id, "delta-marine-service");
  console.log("  seeded delta-marine-service");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
