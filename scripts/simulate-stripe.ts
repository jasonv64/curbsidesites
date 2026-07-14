/**
 * Simulate Stripe webhooks against the local server (demo Stripe provider —
 * only accepted while the real webhook secret is NOT configured).
 *
 * Usage (server running):
 *   npm run stripe:simulate -- <slug> subscribe <curb|curb_plus|curb_pro> [addon ...]
 *   npm run stripe:simulate -- <slug> payment_failed [--days-ago N]
 *   npm run stripe:simulate -- <slug> paid
 *
 * The payment_failed --days-ago flag backdates event.created so the dunning
 * ladder (day 3/7/14 → pending human suspension) can be exercised without
 * waiting two weeks. Follow with `npm run jobs` to run dunning.
 */
import { randomBytes } from "node:crypto";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function post(event: Record<string, unknown>) {
  const res = await fetch("http://127.0.0.1:3000/api/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "demo" },
    body: JSON.stringify(event),
  });
  const body = await res.json();
  console.log(res.status, JSON.stringify(body));
  if (!res.ok) process.exit(1);
}

async function main() {
  const [slug, scenario, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== arg("--days-ago"));
  if (!slug || !scenario) {
    console.error("usage: npm run stripe:simulate -- <slug> <subscribe|payment_failed|paid> [...]");
    process.exit(1);
  }
  const id = () => `evt_demo_${randomBytes(10).toString("hex")}`;
  const customer = `cus_demo_${slug.slice(0, 16)}`;

  if (scenario === "subscribe") {
    const plan = rest[0] ?? "curb";
    const addons = rest.slice(1);
    await post({
      id: id(),
      type: "customer.subscription.created",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `sub_demo_${slug.slice(0, 16)}`,
          status: "active",
          customer,
          metadata: { tenant_slug: slug },
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          items: {
            data: [
              { price: { id: `price_${plan}` } },
              ...addons.map((a) => ({ price: { id: `price_addon_${a}` } })),
            ],
          },
        },
      },
    });
  } else if (scenario === "payment_failed") {
    const daysAgo = Number(arg("--days-ago") ?? 0);
    await post({
      id: id(),
      type: "invoice.payment_failed",
      created: Math.floor(Date.now() / 1000) - daysAgo * 86400,
      data: {
        object: {
          id: `in_demo_${randomBytes(6).toString("hex")}`,
          customer,
          amount_due: 19900,
          metadata: { tenant_slug: slug },
        },
      },
    });
    console.log(daysAgo >= 14
      ? "Backdated past day 14 — run `npm run jobs` to send warnings + prepare the suspension (a human still approves it in /queue)."
      : "Run `npm run jobs` to advance dunning.");
  } else if (scenario === "paid") {
    await post({
      id: id(),
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: `in_demo_${randomBytes(6).toString("hex")}`, customer, metadata: { tenant_slug: slug } } },
    });
  } else {
    console.error(`unknown scenario: ${scenario}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  console.error("Is the server running on :3000?");
  process.exit(1);
});
