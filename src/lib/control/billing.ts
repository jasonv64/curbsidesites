/**
 * Billing sync + the dunning state machine (Part 4, D7, D19).
 *
 * Webhooks keep billing/tenants.plan_tier/feature flags in sync — buying an
 * add-on flips a flag, no provisioning step. The suspension path is the one
 * place LESS automation is correct: failed payment → retries → day 3/7/14
 * warnings → a PENDING ACTION a human approves. Nothing in this file ever
 * sets tenants.status = 'suspended'; only approveSuspension does, and only a
 * staff member calls it.
 */
import type { StripeEvent } from "@/lib/adapters/stripe";
import { audit, controlOne, controlQuery, revalidateTenant } from "@/lib/control/db";
import { notifyStaff, sendPlatformEmail } from "@/lib/control/notify";

// ---------------------------------------------------------------------------
// Price → plan/flag mapping (D19: every plan and add-on is a feature flag).
// Real price ids land in STRIPE_PRICE_MAP (JSON env) in Session 4; the
// defaults below are the demo ids scripts/simulate-stripe.ts uses.
// ---------------------------------------------------------------------------

interface PriceInfo {
  plan_tier?: "curb" | "curb_plus" | "curb_pro";
  flag?: string;
  mrr_cents: number;
}

const DEFAULT_PRICE_MAP: Record<string, PriceInfo> = {
  price_curb: { plan_tier: "curb", mrr_cents: 19900 },
  price_curb_plus: { plan_tier: "curb_plus", mrr_cents: 74900 },
  price_curb_pro: { plan_tier: "curb_pro", mrr_cents: 149900 },
  price_addon_crm: { flag: "crm", mrr_cents: 4900 },
  price_addon_booking: { flag: "booking", mrr_cents: 7900 },
  price_addon_payments: { flag: "payments", mrr_cents: 4900 },
  price_addon_quote_assistant: { flag: "quote_assistant", mrr_cents: 14900 },
  price_addon_call_tracking: { flag: "call_tracking", mrr_cents: 9900 },
};

export function priceMap(): Record<string, PriceInfo> {
  const raw = process.env.STRIPE_PRICE_MAP;
  if (!raw) return DEFAULT_PRICE_MAP;
  try {
    return { ...DEFAULT_PRICE_MAP, ...JSON.parse(raw) };
  } catch {
    console.error("[billing] STRIPE_PRICE_MAP is not valid JSON; using defaults");
    return DEFAULT_PRICE_MAP;
  }
}

// ---------------------------------------------------------------------------
// Tenant resolution: by known customer id, else by metadata.tenant_slug
// (which also links the customer on first contact).
// ---------------------------------------------------------------------------

async function tenantForEvent(obj: {
  customer?: string;
  metadata?: { tenant_slug?: string };
}): Promise<{ id: string; slug: string; owner_email: string | null } | null> {
  if (obj.customer) {
    const byCustomer = await controlOne<{ id: string; slug: string; owner_email: string | null }>(
      `SELECT t.id, t.slug, t.owner_email FROM billing b JOIN tenants t ON t.id = b.tenant_id
        WHERE b.stripe_customer_id = $1`,
      [obj.customer]
    );
    if (byCustomer) return byCustomer;
  }
  const slug = obj.metadata?.tenant_slug;
  if (slug) {
    const tenant = await controlOne<{ id: string; slug: string; owner_email: string | null }>(
      "SELECT id, slug, owner_email FROM tenants WHERE slug = $1",
      [slug]
    );
    if (tenant && obj.customer) {
      await controlQuery(
        `INSERT INTO billing (tenant_id, stripe_customer_id) VALUES ($1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET stripe_customer_id = $2, updated_at = now()`,
        [tenant.id, obj.customer]
      );
    }
    return tenant;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Event application
// ---------------------------------------------------------------------------

async function syncSubscription(tenant: { id: string; slug: string }, sub: {
  id: string;
  status: string;
  customer?: string;
  current_period_end?: number;
  items?: { data?: { price?: { id?: string } }[] };
}): Promise<void> {
  const map = priceMap();
  const items = sub.items?.data ?? [];
  let planTier: PriceInfo["plan_tier"];
  let planPriceId: string | undefined;
  const addonFlags: string[] = [];
  let mrr = 0;
  for (const item of items) {
    const info = item.price?.id ? map[item.price.id] : undefined;
    if (!info) continue;
    mrr += info.mrr_cents;
    if (info.plan_tier) {
      planTier = info.plan_tier;
      planPriceId = item.price!.id;
    }
    if (info.flag) addonFlags.push(info.flag);
  }

  const status = ["active", "trialing", "past_due", "unpaid", "canceled"].includes(sub.status)
    ? sub.status
    : "active";

  await controlQuery(
    `INSERT INTO billing (tenant_id, stripe_customer_id, stripe_subscription_id, status,
                          plan_price_id, addons, mrr_cents, current_period_end, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       stripe_customer_id = COALESCE($2, billing.stripe_customer_id),
       stripe_subscription_id = $3, status = $4, plan_price_id = $5,
       addons = $6, mrr_cents = $7, current_period_end = $8, updated_at = now()`,
    [
      tenant.id,
      sub.customer ?? null,
      sub.id,
      status,
      planPriceId ?? null,
      JSON.stringify(addonFlags),
      mrr,
      sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    ]
  );

  // Buying an add-on flips a flag. Plan tier syncs too. Flags NOT in the map
  // are left alone — intake checkboxes and custom flags survive billing sync.
  const flagUpdates: Record<string, boolean> = {};
  for (const info of Object.values(map)) {
    if (info.flag) flagUpdates[info.flag] = addonFlags.includes(info.flag);
  }
  await controlQuery(
    `UPDATE tenants SET
       plan_tier = COALESCE($2, plan_tier),
       features = features || $3::jsonb,
       updated_at = now()
     WHERE id = $1`,
    [tenant.id, planTier ?? null, JSON.stringify(flagUpdates)]
  );
  await revalidateTenant(tenant.slug);
}

/** Idempotent: the caller has already deduped on stripe_event_id. */
export async function applyStripeEvent(event: StripeEvent): Promise<{ handled: boolean; note: string }> {
  const obj = event.data.object ?? {};
  const tenant = await tenantForEvent(obj);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      if (!tenant) return { handled: false, note: "no tenant match (customer id or metadata.tenant_slug)" };
      await syncSubscription(tenant, obj);
      await audit("stripe-webhook", tenant.id, "billing.subscription_synced", {
        subscription: obj.id,
        status: obj.status,
      });
      return { handled: true, note: `subscription synced for ${tenant.slug}` };
    }
    case "customer.subscription.deleted": {
      if (!tenant) return { handled: false, note: "no tenant match" };
      await controlQuery(
        "UPDATE billing SET status = 'canceled', mrr_cents = 0, updated_at = now() WHERE tenant_id = $1",
        [tenant.id]
      );
      await notifyStaff({
        tenantId: tenant.id,
        kind: "subscription_canceled",
        severity: "warn",
        message: `${tenant.slug}: subscription canceled — offboarding decision needed`,
      });
      await audit("stripe-webhook", tenant.id, "billing.subscription_canceled", {});
      return { handled: true, note: `subscription canceled for ${tenant.slug}` };
    }
    case "invoice.payment_failed": {
      if (!tenant) return { handled: false, note: "no tenant match" };
      const failedAt = new Date((event.created || Date.now() / 1000) * 1000).toISOString();
      const existing = await controlOne<{ id: string }>(
        `SELECT id FROM payment_failures WHERE tenant_id = $1 AND status IN ('open','pending_suspension')
          ORDER BY created_at DESC LIMIT 1`,
        [tenant.id]
      );
      if (existing) {
        await controlQuery(
          "UPDATE payment_failures SET retries = retries + 1, last_failed_at = $2 WHERE id = $1",
          [existing.id, failedAt]
        );
      } else {
        await controlQuery(
          `INSERT INTO payment_failures (tenant_id, stripe_invoice_id, amount_cents, first_failed_at, last_failed_at)
           VALUES ($1, $2, $3, $4, $4)`,
          [tenant.id, obj.id ?? null, obj.amount_due ?? 0, failedAt]
        );
        await controlQuery(
          "UPDATE billing SET status = 'past_due', updated_at = now() WHERE tenant_id = $1",
          [tenant.id]
        );
      }
      await notifyStaff({
        tenantId: tenant.id,
        kind: "payment_failed",
        severity: "warn",
        message: `${tenant.slug}: payment failed ($${((obj.amount_due ?? 0) / 100).toFixed(2)})`,
      });
      return { handled: true, note: `payment failure recorded for ${tenant.slug}` };
    }
    case "invoice.paid": {
      if (!tenant) return { handled: false, note: "no tenant match" };
      await controlQuery(
        `UPDATE payment_failures SET status = 'recovered' WHERE tenant_id = $1 AND status IN ('open','pending_suspension')`,
        [tenant.id]
      );
      await controlQuery(
        `UPDATE billing SET status = 'active', updated_at = now() WHERE tenant_id = $1 AND status IN ('past_due','unpaid','none')`,
        [tenant.id]
      );
      // A recovered payment also moots any pending suspension approval.
      await controlQuery(
        `UPDATE pending_actions SET status = 'dismissed', decided_at = now(), note = 'auto-dismissed: invoice paid'
          WHERE tenant_id = $1 AND kind = 'suspend_tenant' AND status = 'pending'`,
        [tenant.id]
      );
      await audit("stripe-webhook", tenant.id, "billing.payment_recovered", {});
      return { handled: true, note: `payment recovered for ${tenant.slug}` };
    }
    default:
      return { handled: false, note: `ignored event type ${event.type}` };
  }
}

// ---------------------------------------------------------------------------
// Dunning (the day-3/7/14 ladder) — runs from the jobs runner
// ---------------------------------------------------------------------------

const WARNING_DAYS = [3, 7, 14] as const;

export async function runDunning(now = new Date()): Promise<{ warned: number; prepared: number }> {
  const open = await controlQuery<{
    id: string; tenant_id: string; first_failed_at: string; warnings: { day: number }[];
    amount_cents: number; slug: string; owner_email: string | null; business_name: string;
  }>(
    `SELECT f.id, f.tenant_id, f.first_failed_at, f.warnings, f.amount_cents,
            t.slug, t.owner_email, t.business_name
       FROM payment_failures f JOIN tenants t ON t.id = f.tenant_id
      WHERE f.status = 'open'`
  );

  let warned = 0;
  let prepared = 0;
  for (const f of open) {
    const days = Math.floor((now.getTime() - new Date(f.first_failed_at).getTime()) / 86_400_000);
    const sent = new Set((f.warnings ?? []).map((w) => w.day));
    for (const day of WARNING_DAYS) {
      if (days >= day && !sent.has(day)) {
        if (f.owner_email) {
          await sendPlatformEmail({
            to: f.owner_email,
            subject:
              day < 14
                ? `${f.business_name}: payment didn't go through — we'll keep retrying`
                : `${f.business_name}: final notice before your site pauses`,
            text: [
              `Hi — the payment for your Curbside Sites plan ($${(f.amount_cents / 100).toFixed(2)}) hasn't gone through (day ${day}).`,
              day < 14
                ? "Usually this is an expired card or a bank hiccup. Update your payment method and it clears itself — nothing else changes."
                : "If it isn't resolved soon, a human here (not a robot) reviews the account before anything pauses. Call or reply and we'll sort it out — we'd much rather fix a card than pause a site.",
              "",
              "— Curbside Sites billing",
            ].join("\n"),
          });
        }
        sent.add(day);
        warned++;
      }
    }
    await controlQuery("UPDATE payment_failures SET warnings = $2 WHERE id = $1", [
      f.id,
      JSON.stringify([...sent].sort((a, b) => a - b).map((day) => ({ day, sent_at: now.toISOString() }))),
    ]);

    // Day 14 passed and warned → PREPARE the suspension. A person takes it.
    if (days >= 14 && sent.has(14)) {
      const existing = await controlOne(
        `SELECT 1 FROM pending_actions WHERE tenant_id = $1 AND kind = 'suspend_tenant' AND status = 'pending'`,
        [f.tenant_id]
      );
      if (!existing) {
        await controlQuery(
          `INSERT INTO pending_actions (tenant_id, kind, reason, payload)
           VALUES ($1, 'suspend_tenant', $2, $3)`,
          [
            f.tenant_id,
            `Non-payment: $${(f.amount_cents / 100).toFixed(2)} outstanding for ${days} days, 3 warnings sent.`,
            JSON.stringify({ payment_failure_id: f.id, days_outstanding: days }),
          ]
        );
        await controlQuery("UPDATE payment_failures SET status = 'pending_suspension' WHERE id = $1", [f.id]);
        await notifyStaff({
          tenantId: f.tenant_id,
          kind: "suspension_pending",
          severity: "critical",
          message: `${f.slug}: suspension PREPARED after ${days} days non-payment — needs your approval (never automatic)`,
        });
        prepared++;
      }
    }
  }
  return { warned, prepared };
}

/** The human gate. Only path in the codebase that suspends for non-payment. */
export async function approveSuspension(actionId: string, staff: { id: string; email: string }): Promise<void> {
  const action = await controlOne<{ id: string; tenant_id: string; payload: { payment_failure_id?: string } }>(
    `SELECT id, tenant_id, payload FROM pending_actions
      WHERE id = $1 AND kind = 'suspend_tenant' AND status = 'pending'`,
    [actionId]
  );
  if (!action) throw new Error("No pending suspension with that id (already decided?)");
  const tenant = await controlOne<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [action.tenant_id]);

  await controlQuery("UPDATE tenants SET status = 'suspended', updated_at = now() WHERE id = $1", [action.tenant_id]);
  if (action.payload?.payment_failure_id) {
    await controlQuery("UPDATE payment_failures SET status = 'suspended' WHERE id = $1", [
      action.payload.payment_failure_id,
    ]);
  }
  await controlQuery(
    "UPDATE pending_actions SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1",
    [actionId, staff.id]
  );
  if (tenant) await revalidateTenant(tenant.slug);
  await audit(staff.email, action.tenant_id, "tenant.suspended", { via: "pending_action", action_id: actionId });
}
