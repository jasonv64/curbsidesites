/**
 * The onboarding pipeline (Part 2) — the machine that makes client #2 cheap.
 *
 * One intake form submission → ONE control-role transaction that writes a
 * complete draft tenant: tenants, business_profile, services, brand (from the
 * generated proposal, so the draft renders immediately), images, integrations,
 * consents, the intake receipt, the auto-booked call, and the brand-gate
 * proposal row. Zero human database access anywhere in the path (Part 12.2).
 *
 * The checkboxes ARE the feature flags (D19). The consent checkbox becomes a
 * consents row with the exact language (2.2). The tenant is immediately
 * browsable at its platform subdomain via its preview token (2.5).
 */
import { controlTx, audit } from "@/lib/control/db";
import { proposeBrand, type BrandProposal } from "@/lib/control/brand-proposal";
import {
  INDUSTRIES,
  RECORDING_CONSENT_TEXT,
  TERMS_CONSENT_TEXT,
  type IntakeInput,
} from "@/lib/control/intake-schema";
import { notifyStaff, sendPlatformEmail } from "@/lib/control/notify";
import { DAY_KEYS } from "@/lib/schemas";

const j = (v: unknown) => JSON.stringify(v);

// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parsePhone(raw: string): { display: string; tel: string } | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return {
    display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
    tel: `+1${digits}`,
  };
}

/** Form hours model → the tenant app's hours shape (day → [[open, close]]). */
function toHours(input: IntakeInput["hours"]): Record<string, [string, string][]> {
  const out: Record<string, [string, string][]> = {};
  for (const day of DAY_KEYS) {
    const d = input[day];
    out[day] = !d || d.closed ? [] : [[d.open, d.close]];
  }
  return out;
}

/** 2.4: the call books itself — next business day, 10:00 local. */
export function nextCallSlot(from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

const INTEGRATION_KEYS: [key: string, owner: string][] = [
  ["reviews_google", "client"],
  ["reviews_yelp", "client"],
  ["instagram", "client"],
  ["analytics", "curbside"],
  ["email", "curbside"],
  ["newsletter", "curbside"],
  ["payments", "client"],
  ["booking", "curbside"],
  ["quote_assistant", "curbside"],
  ["call_tracking", "curbside"],
  ["change_request_ai", "curbside"],
  // Growth plane (Session 3). gbp is client-owned: manager access, never
  // their login (D8). Existing tenants were backfilled by migration 005.
  ["gbp", "client"],
  ["rank_tracking", "curbside"],
];

/** Default image slot manifest, queries tuned to trade + town (Part 10). */
function imageSlots(input: IntakeInput): [slot: string, purpose: string, query: string, aspect: string, alt: string][] {
  const trade = INDUSTRIES[input.industry].label.split(" / ")[0].toLowerCase();
  const city = input.city;
  const slots: [string, string, string, string, string][] = [
    ["hero", "hero background", `${trade} work site ${city} california`, "16:9", `${input.business_name} at work`],
    ["about-shop", "about section", `${trade} workshop tools`, "4:3", `The ${input.business_name} shop`],
  ];
  input.services.slice(0, 2).forEach((s) => {
    slots.push([
      `service-${slugify(s.name)}`,
      "services page",
      `${s.name.toLowerCase()} ${trade}`,
      "4:3",
      s.name,
    ]);
  });
  for (let i = 1; i <= 6; i++) {
    slots.push([`gallery-${i}`, "gallery", `${trade} ${i % 2 ? "detail work" : "finished job"}`, i === 1 ? "2:1" : "1:1", `${input.business_name} recent work`]);
  }
  return slots;
}

// ---------------------------------------------------------------------------

export interface OnboardResult {
  tenantId: string;
  slug: string;
  previewToken: string;
  callAt: Date;
  proposal: BrandProposal;
}

export class IntakeError extends Error {}

/**
 * The whole trick, in one function. Uploads are attached AFTER the
 * transaction (attachUploads) because the final slug — which names the
 * upload directory — is only settled inside it (dedupe).
 */
export async function createTenantFromIntake(
  input: IntakeInput,
  opts: { logoBuffer?: Buffer; ip?: string } = {}
): Promise<OnboardResult> {
  const phone = parsePhone(input.phone);
  if (!phone) throw new IntakeError("Phone number must be a 10-digit US number.");

  const base = slugify(input.business_name);
  if (!base) throw new IntakeError("Business name must contain letters or numbers.");

  const proposal = await proposeBrand(input.industry, opts.logoBuffer);

  const result = await controlTx(async (db) => {
    // Slug dedupe inside the transaction so two simultaneous "Joe's Plumbing"
    // submissions can't collide.
    const taken = new Set(
      (await db.query<{ slug: string }>("SELECT slug FROM tenants WHERE slug LIKE $1", [`${base}%`])).map(
        (r) => r.slug
      )
    );
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

    // Feature flags directly from the checkboxes (D19). `blog` and `seo` are
    // content flags; the rest gate sections/adapters in the tenant app.
    const features: Record<string, boolean> = {};
    for (const addon of input.addons) features[addon] = true;

    const tenant = await db.one<{ id: string; preview_token: string }>(
      `INSERT INTO tenants (slug, business_name, status, plan_tier, features, owner_email)
       VALUES ($1, $2, 'draft', 'curb', $3, $4) RETURNING id, preview_token`,
      [slug, input.business_name, j(features), input.email.toLowerCase()]
    );
    if (!tenant) throw new IntakeError("tenant insert returned nothing");
    const tid = tenant.id;

    await db.query(
      `INSERT INTO business_profile
         (tenant_id, nap, hours, socials, service_area, schema_subtype, about, voice_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tid,
        j({
          name: input.business_name,
          street: input.street,
          city: input.city,
          region: input.region.toUpperCase(),
          postal: input.postal,
          phone_display: phone.display,
          phone_tel: phone.tel,
        }),
        j(toHours(input.hours)),
        j({
          instagram: input.instagram || undefined,
          facebook: input.facebook || undefined,
          google_maps_url: input.google_maps_url || undefined,
        }),
        input.service_area.split(",").map((s) => s.trim()).filter(Boolean),
        INDUSTRIES[input.industry].subtype,
        input.voice, // first-pass about copy; content seeding (2.6) refines it
        input.voice, // the 2.2.3 fallback voice source, verbatim
      ]
    );

    for (let i = 0; i < input.services.length; i++) {
      const s = input.services[i];
      await db.query(
        "INSERT INTO services (tenant_id, slug, name, blurb, sort_order) VALUES ($1, $2, $3, $4, $5)",
        [tid, slugify(s.name) || `service-${i + 1}`, s.name, s.blurb, i]
      );
    }

    // Brand row gets the PROPOSED tokens so the draft renders now; the brand
    // GATE (2.3) gates draft → live, not draft → browsable.
    await db.query(
      "INSERT INTO brand (tenant_id, tokens, font_pairing_key) VALUES ($1, $2, $3)",
      [tid, j(proposal.tokens), proposal.font_pairing_key]
    );
    await db.query(
      `INSERT INTO brand_proposals (tenant_id, tokens, font_pairing_key, notes)
       VALUES ($1, $2, $3, $4)`,
      [tid, j(proposal.tokens), proposal.font_pairing_key, j(proposal.notes)]
    );

    // Image manifest: URLs attach after the transaction (attachUploads);
    // until then every slot renders a branded placeholder (nothing 404s, D11).
    for (const [slot, purpose, query, aspect, alt] of imageSlots(input)) {
      await db.query(
        `INSERT INTO images (tenant_id, slot_id, purpose, search_query, aspect, alt)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tid, slot, purpose, query, aspect, alt]
      );
    }

    for (const [key, owner] of INTEGRATION_KEYS) {
      await db.query(
        `INSERT INTO integrations (tenant_id, key, mode, kv_secret_ref, key_owner)
         VALUES ($1, $2, 'demo', $3, $4)`,
        [tid, key, `tenant-${slug}-${key.replace(/_/g, "-")}-key`, owner]
      );
    }

    // Consents (2.2): terms always (the form requires it); recording consent
    // ONLY if its distinct checkbox was ticked. No consent → the call happens
    // unrecorded and the pipeline degrades to the voice field. That is normal.
    await db.query(
      `INSERT INTO consents (tenant_id, kind, source, consent_text) VALUES ($1, 'terms_of_service', 'intake_form', $2)`,
      [tid, TERMS_CONSENT_TEXT]
    );
    if (input.consent_recording) {
      await db.query(
        `INSERT INTO consents (tenant_id, kind, source, consent_text) VALUES ($1, 'call_recording_ai', 'intake_form', $2)`,
        [tid, RECORDING_CONSENT_TEXT]
      );
    }

    // Domain intent (D8: registrar NAME only; provisioning is a staff action
    // after the call — 2.5). "No domain yet" or none given → skip.
    if (input.existing_domain && input.registrar !== "No domain yet") {
      await db.query(
        `INSERT INTO domains (tenant_id, hostname, is_primary, registrar, verification_status)
         VALUES ($1, $2, true, $3, 'unmanaged')`,
        [tid, input.existing_domain.toLowerCase(), input.registrar]
      );
    }

    const callAt = nextCallSlot();
    await db.query(
      "INSERT INTO onboarding_calls (tenant_id, scheduled_at) VALUES ($1, $2)",
      [tid, callAt.toISOString()]
    );

    await db.query(
      "INSERT INTO intake_submissions (tenant_id, payload, ip) VALUES ($1, $2, $3)",
      [tid, j({ ...input, website: undefined }), opts.ip ?? null]
    );

    return { tenantId: tid, slug, previewToken: tenant.preview_token, callAt };
  });

  await audit("pipeline", result.tenantId, "intake.tenant_created", {
    slug: result.slug,
    industry: input.industry,
    addons: input.addons,
    recording_consent: input.consent_recording,
  });
  await notifyStaff({
    tenantId: result.tenantId,
    kind: "new_intake",
    severity: "info",
    message: `New intake: ${input.business_name} (${result.slug}) — brand gate pending`,
    detail: { slug: result.slug, call_at: result.callAt.toISOString() },
  });

  return { ...result, proposal };
}

/**
 * Attach saved uploads to the tenant created above. Runs after the
 * transaction because the upload directory is named by the FINAL slug.
 * Uploaded photos fill gallery slots in order; the logo lands on the brand row.
 */
export async function attachUploads(
  tenantId: string,
  opts: { logoUrl?: string; photoUrls?: string[] }
): Promise<void> {
  const { controlQuery } = await import("@/lib/control/db");
  if (opts.logoUrl) {
    await controlQuery("UPDATE brand SET logo_url = $2, updated_at = now() WHERE tenant_id = $1", [
      tenantId,
      opts.logoUrl,
    ]);
  }
  const photos = opts.photoUrls ?? [];
  for (let i = 0; i < photos.length && i < 6; i++) {
    await controlQuery(
      "UPDATE images SET url = $3, credit = NULL WHERE tenant_id = $1 AND slot_id = $2",
      [tenantId, `gallery-${i + 1}`, photos[i]]
    );
  }
}

/** The confirmation the prospect gets — includes their preview link (2.5). */
export async function sendIntakeReceipt(
  input: IntakeInput,
  previewUrl: string,
  callAt: Date
): Promise<void> {
  await sendPlatformEmail({
    to: input.email,
    subject: `${input.business_name} — your new site is already building`,
    text: [
      `Thanks — we have everything we need to start on ${input.business_name}.`,
      "",
      `Your draft site is already up (private preview, just for you):`,
      previewUrl,
      "",
      `Your 30-minute kickoff call is penciled in for ${callAt.toLocaleString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}. We'll confirm by email — if the time doesn't work, just reply.`,
      "",
      input.consent_recording
        ? "You agreed that the kickoff call may be recorded and transcribed; we'll confirm that again at the top of the call, and you can change your mind any time."
        : "You opted not to have the kickoff call recorded — no problem, we'll take notes instead.",
      "",
      "— Curbside Sites",
    ].join("\n"),
  });
}
