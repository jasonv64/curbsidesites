"use server";

/**
 * Tenant-scoped Server Actions (Part 8: Server Actions, not API routes).
 * Tenant comes from the Host header — the same resolution path as rendering,
 * so a form can never write into a different tenant than the page it sits on.
 */
import { headers } from "next/headers";
import { getTenantBundle } from "@/lib/tenant";
import { withTenant } from "@/lib/db";
import { leadInputSchema, subscriberInputSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { attributeSource, trackEvent } from "@/lib/events";
import { sendTenantEmail } from "@/lib/adapters/email";
import { syncSubscriber } from "@/lib/adapters/newsletter";
import { saveUpload } from "@/lib/blob";

export interface LeadFormState {
  status: "idle" | "sent" | "error";
  message: string;
  fieldErrors?: Record<string, string>;
}

async function requestContext() {
  const h = await headers();
  const host = h.get("host") ?? "";
  const ip = (h.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const bundle = await getTenantBundle(host);
  return { bundle, ip };
}

export async function submitLead(
  _prev: LeadFormState,
  formData: FormData
): Promise<LeadFormState> {
  const { bundle, ip } = await requestContext();
  if (!bundle || bundle.tenant.status === "suspended") {
    return { status: "error", message: "This site is not accepting requests right now." };
  }

  // Honeypot: pretend success, write nothing.
  if ((formData.get("website") as string)?.length) {
    return { status: "sent", message: "Thanks — we got your request and will be in touch shortly." };
  }
  if (!rateLimit(`lead:${bundle.tenant.id}:${ip}`, 5, 10 * 60_000)) {
    return { status: "error", message: "Too many requests — give it a few minutes and try again, or just call us." };
  }

  const parsed = leadInputSchema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    preferred: formData.get("preferred") ?? "phone",
    service: formData.get("service") ?? "",
    vehicle: formData.get("vehicle") ?? "",
    message: formData.get("message") ?? "",
    website: formData.get("website") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "form")] = issue.message;
    }
    return { status: "error", message: "Check the highlighted fields and try again.", fieldErrors };
  }
  const input = parsed.data;
  if (!input.email && !input.phone) {
    return {
      status: "error",
      message: "Leave a phone number or an email so we can reach you.",
      fieldErrors: { phone: "Add a phone number or an email." },
    };
  }

  // Photo uploads (Blob Storage in prod, local disk in dev — src/lib/blob.ts)
  const photoUrls: string[] = [];
  for (const file of formData.getAll("photos")) {
    if (!(file instanceof File) || file.size === 0) continue;
    if (photoUrls.length >= 4) break;
    const saved = await saveUpload(bundle.tenant.slug, file);
    if ("publicPath" in saved) photoUrls.push(saved.publicPath);
  }

  const source = attributeSource(
    (formData.get("_referrer") as string) || null,
    (formData.get("_utm_source") as string) || null
  );

  await withTenant(bundle.tenant.id, (db) =>
    db.query(
      `INSERT INTO leads (tenant_id, name, contact, service, vehicle, message, photo_urls, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        bundle.tenant.id,
        input.name,
        JSON.stringify({ email: input.email || undefined, phone: input.phone || undefined, preferred: input.preferred }),
        input.service || null,
        input.vehicle || null,
        input.message,
        photoUrls,
        source,
      ]
    )
  );
  await trackEvent(bundle.tenant.id, "form_submit", { source, service: input.service || null });

  // Owner notification. Adapter demo-falls-back on provider failure; the
  // lead is already in the DB and the portal inbox either way.
  if (bundle.tenant.owner_email) {
    await sendTenantEmail(bundle, {
      to: bundle.tenant.owner_email,
      subject: `New lead: ${input.name}${input.service ? ` — ${input.service}` : ""}`,
      text: [
        `New request from the website (${bundle.tenant.business_name}):`,
        "",
        `Name: ${input.name}`,
        input.phone ? `Phone: ${input.phone}` : null,
        input.email ? `Email: ${input.email}` : null,
        `Prefers: ${input.preferred}`,
        input.service ? `Service: ${input.service}` : null,
        input.vehicle ? `Vehicle/vessel: ${input.vehicle}` : null,
        "",
        input.message,
        "",
        `Reply fast — speed wins these. Manage leads in your portal: /portal`,
      ]
        .filter((l): l is string => l !== null)
        .join("\n"),
    });
  }

  return { status: "sent", message: "Thanks — we got your request and will be in touch shortly." };
}

export interface NewsletterFormState {
  status: "idle" | "sent" | "error";
  message: string;
}

export async function subscribeNewsletter(
  _prev: NewsletterFormState,
  formData: FormData
): Promise<NewsletterFormState> {
  const { bundle, ip } = await requestContext();
  if (!bundle || bundle.tenant.status === "suspended") {
    return { status: "error", message: "Signups are closed right now." };
  }
  if ((formData.get("website") as string)?.length) {
    return { status: "sent", message: "You're on the list." };
  }
  if (!rateLimit(`news:${bundle.tenant.id}:${ip}`, 5, 10 * 60_000)) {
    return { status: "error", message: "Too many attempts — try again in a few minutes." };
  }
  const parsed = subscriberInputSchema.safeParse({
    email: formData.get("email") ?? "",
    website: formData.get("website") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Enter a valid email address." };
  }
  await withTenant(bundle.tenant.id, (db) =>
    db.query(
      `INSERT INTO subscribers (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [bundle.tenant.id, parsed.data.email.toLowerCase()]
    )
  );
  await trackEvent(bundle.tenant.id, "newsletter_signup", {});
  await syncSubscriber(bundle, parsed.data.email.toLowerCase());
  return { status: "sent", message: "You're on the list." };
}
