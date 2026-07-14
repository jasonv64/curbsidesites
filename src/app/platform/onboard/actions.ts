"use server";

/**
 * The intake form's server action (Part 2.1) — the ONLY public write path
 * into the control plane. Validates with Zod, then hands everything to the
 * onboarding pipeline; the response carries the preview URL because the
 * draft site is the sales artifact (2.5).
 */
import { headers } from "next/headers";
import { intakeSchema, type IntakeInput } from "@/lib/control/intake-schema";
import {
  attachUploads,
  createTenantFromIntake,
  sendIntakeReceipt,
  IntakeError,
} from "@/lib/control/onboarding";
import { rateLimit } from "@/lib/rate-limit";
import { saveUpload } from "@/lib/blob";
import { DAY_KEYS } from "@/lib/schemas";

export interface IntakeFormState {
  status: "idle" | "sent" | "error";
  message: string;
  fieldErrors?: Record<string, string>;
  previewUrl?: string;
  callAt?: string;
}

function collectInput(formData: FormData): Record<string, unknown> {
  const names = formData.getAll("service_name").map(String);
  const blurbs = formData.getAll("service_blurb").map(String);
  const services = names
    .map((name, i) => ({ name: name.trim(), blurb: (blurbs[i] ?? "").trim() }))
    .filter((s) => s.name.length > 0);

  const hours: Record<string, { closed: boolean; open: string; close: string }> = {};
  for (const day of DAY_KEYS) {
    hours[day] = {
      closed: formData.get(`hours_${day}_closed`) === "on",
      open: String(formData.get(`hours_${day}_open`) || "08:00"),
      close: String(formData.get(`hours_${day}_close`) || "17:00"),
    };
  }

  return {
    business_name: formData.get("business_name") ?? "",
    industry: formData.get("industry") ?? "general",
    street: formData.get("street") ?? "",
    city: formData.get("city") ?? "",
    region: formData.get("region") ?? "CA",
    postal: formData.get("postal") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    hours,
    service_area: formData.get("service_area") ?? "",
    instagram: formData.get("instagram") ?? "",
    facebook: formData.get("facebook") ?? "",
    google_maps_url: formData.get("google_maps_url") ?? "",
    services,
    voice: formData.get("voice") ?? "",
    registrar: formData.get("registrar") ?? "Other / not sure",
    existing_domain: String(formData.get("existing_domain") ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, ""),
    addons: formData.getAll("addons").map(String),
    consent_terms: formData.get("consent_terms") === "on",
    consent_recording: formData.get("consent_recording") === "on",
    website: formData.get("website") ?? "",
  };
}

export async function submitIntake(
  _prev: IntakeFormState,
  formData: FormData
): Promise<IntakeFormState> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const ip = (h.get("x-forwarded-for") ?? "local").split(",")[0].trim();

  // Honeypot: pretend success, write nothing.
  if ((formData.get("website") as string)?.length) {
    return { status: "sent", message: "Thanks — we'll be in touch shortly." };
  }
  // Generous on purpose: the honeypot + Zod are the real gate (Session 1
  // convention), and a strict window breaks repeated local verify runs
  // against one long-lived server (the limiter is per-instance memory).
  if (!rateLimit(`intake:${ip}`, 10, 30 * 60_000)) {
    return {
      status: "error",
      message: "Too many submissions from this connection — give it a while, or email hello@curbsidesites.com.",
    };
  }

  const parsed = intakeSchema.safeParse(collectInput(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "form")] = issue.message;
    }
    return { status: "error", message: "Check the highlighted fields and try again.", fieldErrors };
  }
  const input: IntakeInput = parsed.data;

  // Files into memory before anything writes.
  const logoFile = formData.get("logo");
  const logoBuffer =
    logoFile instanceof File && logoFile.size > 0 && logoFile.size <= 10 * 1024 * 1024
      ? Buffer.from(await logoFile.arrayBuffer())
      : undefined;
  const photoFiles = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, 6);

  try {
    const result = await createTenantFromIntake(input, { logoBuffer, ip });

    // Uploads land under the FINAL slug, then attach to the rows.
    let logoUrl: string | undefined;
    if (logoFile instanceof File && logoBuffer) {
      const saved = await saveUpload(result.slug, logoFile);
      if ("publicPath" in saved) logoUrl = saved.publicPath;
    }
    const photoUrls: string[] = [];
    for (const f of photoFiles) {
      const saved = await saveUpload(result.slug, f);
      if ("publicPath" in saved) photoUrls.push(saved.publicPath);
    }
    if (logoUrl || photoUrls.length) await attachUploads(result.tenantId, { logoUrl, photoUrls });

    // The sales artifact: a finished draft site, before they've touched DNS.
    const apex = process.env.PLATFORM_APEX ?? "localhost";
    const port = host.includes(":") ? `:${host.split(":")[1]}` : "";
    const proto = apex === "localhost" || apex.endsWith(".test") ? "http" : "https";
    const previewUrl = `${proto}://${result.slug}.${apex}${port}/?preview=${result.previewToken}`;

    await sendIntakeReceipt(input, previewUrl, result.callAt);

    return {
      status: "sent",
      message: `${input.business_name} is building. Your private preview is ready now.`,
      previewUrl,
      callAt: result.callAt.toISOString(),
    };
  } catch (e) {
    if (e instanceof IntakeError) return { status: "error", message: e.message };
    console.error("[intake] pipeline failed:", e);
    return {
      status: "error",
      message: "Something went wrong on our side — nothing was saved. Try again, or email hello@curbsidesites.com.",
    };
  }
}
