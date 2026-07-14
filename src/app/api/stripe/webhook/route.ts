import { stripeProvider } from "@/lib/adapters/stripe";
import { applyStripeEvent } from "@/lib/control/billing";
import { controlQuery } from "@/lib/control/db";

/**
 * POST /api/stripe/webhook — signature-verified ingest (Part 4). Idempotent
 * via billing_events.stripe_event_id: a replay is a 200 no-op, never a
 * double-application. Excluded from the host proxy (platform-level route).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const provider = await stripeProvider();

  let event;
  try {
    event = await provider.verifyWebhook(raw, req.headers.get("stripe-signature"));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "verification failed" },
      { status: 400 }
    );
  }
  if (!event?.id || !event?.type) {
    return Response.json({ error: "malformed event" }, { status: 400 });
  }

  const inserted = await controlQuery(
    `INSERT INTO billing_events (stripe_event_id, type, payload)
     VALUES ($1, $2, $3) ON CONFLICT (stripe_event_id) DO NOTHING RETURNING id`,
    [event.id, event.type, raw]
  );
  if (inserted.length === 0) {
    return Response.json({ received: true, note: "duplicate event — already processed" });
  }

  try {
    const result = await applyStripeEvent(event);
    // Attach the tenant to the receipt when the handler resolved one.
    return Response.json({ received: true, mode: provider.mode, ...result });
  } catch (e) {
    console.error("[stripe] event application failed:", e);
    // 500 → Stripe retries. The dedupe row exists, so remove it to allow the retry to apply.
    await controlQuery("DELETE FROM billing_events WHERE stripe_event_id = $1", [event.id]);
    return Response.json({ error: "application failed" }, { status: 500 });
  }
}
