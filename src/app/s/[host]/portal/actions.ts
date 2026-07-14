"use server";

/**
 * Portal server actions. Every action re-resolves the tenant from Host and
 * re-validates the session against THAT tenant (D16: scoped to exactly one).
 * Config writes call updateTag so the owner sees their change immediately
 * (read-your-writes) and only their own tenant's cache is touched (Part 4).
 */
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { z } from "zod";
import {
  getTenantBundle,
  tenantTag,
  canonicalOrigin,
  type ResolvedBundle,
  type TenantBundle,
} from "@/lib/tenant";
import { withTenant } from "@/lib/db";
import {
  getPortalSession,
  requestMagicLink,
  revokeSession,
  PORTAL_COOKIE,
  type PortalSession,
} from "@/lib/portal-auth";
import { rateLimit } from "@/lib/rate-limit";
import { changeDiffSchema, hoursSchema, slugSchema, type ChangeDiff, type Hours } from "@/lib/schemas";
import { getChangeParser } from "@/lib/adapters/change-requests";
import { upsertPost } from "@/lib/content";
import { DAY_KEYS } from "@/lib/schemas";

async function ctx(): Promise<{ bundle: ResolvedBundle; host: string; ip: string }> {
  const h = await headers();
  const host = h.get("host") ?? "";
  const bundle = await getTenantBundle(host);
  if (!bundle) throw new Error("unknown host");
  return { bundle, host, ip: (h.get("x-forwarded-for") ?? "local").split(",")[0].trim() };
}

async function requireSession(bundle: TenantBundle): Promise<PortalSession> {
  const session = await getPortalSession(bundle);
  if (!session) redirect("/portal");
  return session;
}

// --- Auth --------------------------------------------------------------------

export interface LoginState {
  status: "idle" | "sent" | "error";
  message: string;
}

export async function requestLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { bundle, host, ip } = await ctx();
  if (!rateLimit(`magic:${bundle.tenant.id}:${ip}`, 5, 10 * 60_000)) {
    return { status: "error", message: "Too many attempts — wait a few minutes." };
  }
  const email = z.string().email().safeParse(formData.get("email"));
  if (!email.success) return { status: "error", message: "Enter a valid email address." };
  const origin = canonicalOrigin(bundle, bundle.hostKind, host);
  await requestMagicLink(bundle, email.data, origin);
  // Same answer whether or not the email matched — no enumeration.
  return {
    status: "sent",
    message:
      "If that's the owner email on file, a sign-in link is on its way. It's good for 15 minutes.",
  };
}

export async function logout(): Promise<void> {
  const { bundle } = await ctx();
  await revokeSession(bundle);
  (await cookies()).delete(PORTAL_COOKIE);
  redirect("/portal");
}

// --- Leads -------------------------------------------------------------------

const leadStatusSchema = z.enum(["new", "contacted", "quoted", "won", "lost"]);

export async function updateLeadStatus(formData: FormData): Promise<void> {
  const { bundle } = await ctx();
  await requireSession(bundle);
  const id = z.string().uuid().safeParse(formData.get("lead_id"));
  const status = leadStatusSchema.safeParse(formData.get("status"));
  if (!id.success || !status.success) return;
  await withTenant(bundle.tenant.id, (db) =>
    db.query("UPDATE leads SET status = $2 WHERE id = $1 AND is_demo = false", [
      id.data,
      status.data,
    ])
  );
}

// --- Content (D18: publish = DB write + revalidation, never a deploy) --------

export interface ContentSaveState {
  status: "idle" | "saved" | "error";
  message: string;
}

export async function savePost(_prev: ContentSaveState, formData: FormData): Promise<ContentSaveState> {
  const { bundle } = await ctx();
  await requireSession(bundle);
  const result = await upsertPost(bundle.tenant.id, {
    slug: String(formData.get("slug") ?? ""),
    frontmatter: {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      date: String(formData.get("date") ?? ""),
      author: String(formData.get("author") ?? ""),
      tags: String(formData.get("tags") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    },
    body: String(formData.get("body") ?? ""),
    publish: formData.get("publish") === "on",
  });
  if (!result.ok) return { status: "error", message: result.error };
  updateTag(tenantTag(bundle.tenant.slug));
  return { status: "saved", message: "Saved. Published changes are live now." };
}

// --- Settings (hours / services / tagline) ------------------------------------

export interface SettingsState {
  status: "idle" | "saved" | "error";
  message: string;
}

export async function saveHours(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { bundle } = await ctx();
  await requireSession(bundle);
  const hours: Hours = {};
  for (const day of DAY_KEYS) {
    if (formData.get(`${day}_closed`) === "on") {
      hours[day] = [];
      continue;
    }
    const open = String(formData.get(`${day}_open`) ?? "").trim();
    const close = String(formData.get(`${day}_close`) ?? "").trim();
    if (!open && !close) {
      hours[day] = [];
      continue;
    }
    hours[day] = [[open, close]];
  }
  const parsed = hoursSchema.safeParse(hours);
  if (!parsed.success) {
    return { status: "error", message: "Times must be HH:MM (24-hour), e.g. 08:00 and 17:30." };
  }
  await withTenant(bundle.tenant.id, (db) =>
    db.query(
      "UPDATE business_profile SET hours = $2, updated_at = now() WHERE tenant_id = $1",
      [bundle.tenant.id, JSON.stringify(parsed.data)]
    )
  );
  updateTag(tenantTag(bundle.tenant.slug));
  return { status: "saved", message: "Hours updated — live on the site now." };
}

export async function saveService(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { bundle } = await ctx();
  await requireSession(bundle);
  const slug = slugSchema.safeParse(String(formData.get("slug") ?? "").trim());
  const name = z.string().min(2).max(80).safeParse(String(formData.get("name") ?? "").trim());
  const blurb = z.string().max(400).safeParse(String(formData.get("blurb") ?? "").trim());
  if (!slug.success || !name.success || !blurb.success) {
    return { status: "error", message: "Slug (lowercase-with-hyphens) and name are required." };
  }
  await withTenant(bundle.tenant.id, (db) =>
    db.query(
      `INSERT INTO services (tenant_id, slug, name, blurb, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM services WHERE tenant_id = $1))
       ON CONFLICT (tenant_id, slug)
       DO UPDATE SET name = $3, blurb = $4, updated_at = now()`,
      [bundle.tenant.id, slug.data, name.data, blurb.data]
    )
  );
  updateTag(tenantTag(bundle.tenant.slug));
  return { status: "saved", message: `Service "${name.data}" saved — it's already on the site.` };
}

// --- Change-request chat (D9) --------------------------------------------------

export interface ChatState {
  status: "idle" | "proposed" | "applied" | "escalated" | "error";
  message: string;
  requestId?: string;
  confirmation?: string;
}

export async function proposeChange(_prev: ChatState, formData: FormData): Promise<ChatState> {
  const { bundle, ip } = await ctx();
  await requireSession(bundle);
  if (!rateLimit(`chat:${bundle.tenant.id}:${ip}`, 20, 10 * 60_000)) {
    return { status: "error", message: "Slow down a touch — try again in a few minutes." };
  }
  const message = z.string().min(3).max(2000).safeParse(formData.get("message"));
  if (!message.success) return { status: "error", message: "Tell me what you'd like changed." };

  const parser = await getChangeParser(bundle);
  const parsed = await parser.parse(message.data);

  const row = await withTenant(bundle.tenant.id, (db) =>
    db.one(
      `INSERT INTO change_requests (tenant_id, raw_message, parsed_diff, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        bundle.tenant.id,
        message.data,
        JSON.stringify(parsed.diff),
        parsed.diff.kind === "escalate" ? "escalated" : "pending",
      ]
    )
  );

  if (parsed.diff.kind === "escalate") {
    return { status: "escalated", message: parsed.confirmation };
  }
  return {
    status: "proposed",
    message: parsed.confirmation,
    confirmation: parsed.confirmation,
    requestId: row?.id,
  };
}

export async function confirmChange(_prev: ChatState, formData: FormData): Promise<ChatState> {
  const { bundle } = await ctx();
  await requireSession(bundle);
  const id = z.string().uuid().safeParse(formData.get("request_id"));
  const decision = formData.get("decision");
  if (!id.success) return { status: "error", message: "That request can't be found." };

  if (decision !== "confirm") {
    await withTenant(bundle.tenant.id, (db) =>
      db.query(
        "UPDATE change_requests SET status = 'rejected' WHERE id = $1 AND status = 'pending'",
        [id.data]
      )
    );
    return { status: "idle", message: "No problem — nothing was changed." };
  }

  const request = await withTenant(bundle.tenant.id, (db) =>
    db.one("SELECT parsed_diff FROM change_requests WHERE id = $1 AND status = 'pending'", [id.data])
  );
  if (!request) return { status: "error", message: "That request was already handled." };
  const diff = changeDiffSchema.safeParse(request.parsed_diff);
  if (!diff.success || diff.data.kind === "escalate") {
    return { status: "error", message: "That change needs a human — it's in the Curbside queue." };
  }

  await applyDiff(bundle, diff.data);
  await withTenant(bundle.tenant.id, (db) =>
    db.query(
      "UPDATE change_requests SET status = 'applied', confirmed_at = now(), applied_at = now() WHERE id = $1",
      [id.data]
    )
  );
  updateTag(tenantTag(bundle.tenant.slug));
  return { status: "applied", message: "Done — the change is live on your site." };
}

/** The ONLY code path that applies a parsed diff. Typed cases, nothing else. */
async function applyDiff(bundle: TenantBundle, diff: ChangeDiff): Promise<void> {
  await withTenant(bundle.tenant.id, async (db) => {
    switch (diff.kind) {
      case "hours_update":
        await db.query(
          "UPDATE business_profile SET hours = $2, updated_at = now() WHERE tenant_id = $1",
          [bundle.tenant.id, JSON.stringify(diff.hours)]
        );
        break;
      case "tagline_update":
        await db.query(
          "UPDATE business_profile SET tagline = $2, updated_at = now() WHERE tenant_id = $1",
          [bundle.tenant.id, diff.tagline]
        );
        break;
      case "service_add":
        await db.query(
          `INSERT INTO services (tenant_id, slug, name, blurb, sort_order)
           VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM services WHERE tenant_id = $1))
           ON CONFLICT (tenant_id, slug) DO NOTHING`,
          [bundle.tenant.id, diff.slug, diff.name, diff.blurb]
        );
        break;
      case "service_update":
        await db.query(
          `UPDATE services SET
             name = COALESCE($3, name),
             blurb = COALESCE($4, blurb),
             updated_at = now()
           WHERE tenant_id = $1 AND slug = $2`,
          [bundle.tenant.id, diff.slug, diff.name ?? null, diff.blurb ?? null]
        );
        break;
    }
  });
}
