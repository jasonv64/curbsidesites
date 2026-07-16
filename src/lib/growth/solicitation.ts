/**
 * Review solicitation (Part 7): ask the happy customer at the right moment.
 * Mostly a timing problem — the moment is a few days after the owner marks a
 * lead WON, once the work is done and the glow is still on.
 *
 * Mechanics: the daily scan queues one ask per won lead (lead_id UNIQUE —
 * nobody gets nagged twice), scheduled +3 days, sent by email through the
 * TENANT's email adapter (it comes from the shop, not from Curbside). SMS
 * joins when A2P clears (ARCHITECTURE §6). Curb+ and up (D19).
 */
import { controlOne, controlQuery } from "@/lib/control/db";
import { minimalBundle } from "@/lib/control/jobs";
import { sendTenantEmail } from "@/lib/adapters/email";
import type { RunStatus } from "./scheduler";

const ASK_DELAY_DAYS = 3;

export function solicitationEnabled(plan_tier: string, features: Record<string, boolean>): boolean {
  return plan_tier === "curb_plus" || plan_tier === "curb_pro" || features?.review_solicitation === true;
}

export async function runSolicitation(tenant: {
  tenant_id: string;
  slug: string;
}): Promise<{ status: RunStatus; detail: Record<string, unknown> }> {
  // 1. Queue new asks: won, real, has an email, never asked before.
  const queued = await controlQuery<{ id: string }>(
    `INSERT INTO review_requests (tenant_id, lead_id, scheduled_for)
     SELECT l.tenant_id, l.id, (CURRENT_DATE + $2::int)
       FROM leads l
      WHERE l.tenant_id = $1 AND l.status = 'won' AND l.is_demo = false
        AND l.source <> 'synthetic' AND l.contact->>'email' IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM review_requests rr WHERE rr.lead_id = l.id)
     RETURNING id`,
    [tenant.tenant_id, ASK_DELAY_DAYS]
  );

  // 2. Send what's due.
  const due = await controlQuery<{ id: string; lead_name: string; email: string; service: string | null }>(
    `SELECT rr.id, l.name AS lead_name, l.contact->>'email' AS email, l.service
       FROM review_requests rr JOIN leads l ON l.id = rr.lead_id
      WHERE rr.tenant_id = $1 AND rr.sent_at IS NULL AND rr.scheduled_for <= CURRENT_DATE`,
    [tenant.tenant_id]
  );
  if (due.length === 0) {
    return { status: "ok", detail: { queued: queued.length, sent: 0 } };
  }

  const row = await controlOne<{
    id: string; slug: string; business_name: string; status: string; plan_tier: string;
    features: Record<string, boolean>; owner_email: string | null; preview_token: string;
  }>(
    `SELECT id, slug, business_name, status, plan_tier, features, owner_email, preview_token
       FROM tenants WHERE id = $1`,
    [tenant.tenant_id]
  );
  if (!row) return { status: "failed", detail: { error: "tenant vanished mid-run" } };
  const bundle = await minimalBundle(row);
  const links = await reviewLinks(tenant.tenant_id);

  let sent = 0;
  for (const ask of due) {
    const firstName = ask.lead_name.split(/\s+/)[0];
    const lines = [
      `Hi ${firstName},`,
      "",
      `Thanks for trusting ${row.business_name}${ask.service ? ` with your ${ask.service.toLowerCase()}` : ""} — jobs like yours are how a local shop stays open.`,
      "",
      `If you were happy with the work, a short review helps the next person find us more than anything else we could do:`,
      "",
      ...(links.google ? [`  Google: ${links.google}`] : []),
      ...(links.yelp ? [`  Yelp: ${links.yelp}`] : []),
      ...(!links.google && !links.yelp ? [`  Just search for "${row.business_name}" and leave it wherever you found us.`] : []),
      "",
      `And if anything wasn't right — reply to this email and tell us first. We'd rather fix it than read about it.`,
      "",
      `— ${row.business_name}`,
    ];
    const result = await sendTenantEmail(bundle, {
      to: ask.email,
      subject: `How did we do, ${firstName}?`,
      text: lines.join("\n"),
    });
    await controlQuery("UPDATE review_requests SET sent_at = now() WHERE id = $1", [ask.id]);
    sent++;
    void result;
  }
  return { status: "ok", detail: { queued: queued.length, sent } };
}

/** Direct write-a-review links, from config we already hold. Never guessed. */
async function reviewLinks(tenantId: string): Promise<{ google: string | null; yelp: string | null }> {
  const rows = await controlQuery<{ key: string; config: Record<string, string> }>(
    "SELECT key, config FROM integrations WHERE tenant_id = $1 AND key IN ('reviews_google','reviews_yelp')",
    [tenantId]
  );
  const profile = await controlOne<{ socials: { google_maps_url?: string; yelp_url?: string } }>(
    "SELECT socials FROM business_profile WHERE tenant_id = $1",
    [tenantId]
  );
  const placeId = rows.find((r) => r.key === "reviews_google")?.config?.place_id;
  const yelpId = rows.find((r) => r.key === "reviews_yelp")?.config?.business_id;
  return {
    google: placeId
      ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
      : (profile?.socials?.google_maps_url ?? null),
    yelp: yelpId
      ? `https://www.yelp.com/writeareview/biz/${encodeURIComponent(yelpId)}`
      : (profile?.socials?.yelp_url ?? null),
  };
}
