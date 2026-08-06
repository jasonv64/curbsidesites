/**
 * "Nothing automated ever suspends" — ASSUMPTIONS #44, promoted to a tested
 * invariant on D7 (02-BUILD-PROMPT Session 1).
 *
 * The dunning ladder may email all it wants; its day-14 endpoint is CREATING
 * a pending_actions row for a human. Only approveSuspension (a staff click)
 * writes status='suspended'. If an automation path ever suspends a live
 * business's phone line over a $2 decline, this test is what fails.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDunning, approveSuspension } from "../src/lib/control/billing";
import { controlOne, controlQuery } from "../src/lib/control/db";

const SLUG = "unit-test-dunning-co";
const STAFF_EMAIL = "unit-test-dunning@curbsidesites.test";
let tenantId = "";
let staffId = "";

beforeAll(async () => {
  await controlQuery("DELETE FROM tenants WHERE slug = $1", [SLUG]);
  await controlQuery("DELETE FROM staff_users WHERE email = $1", [STAFF_EMAIL]);
  const t = await controlOne<{ id: string }>(
    `INSERT INTO tenants (slug, business_name, status, plan_tier, owner_email)
     VALUES ($1, 'Unit Test Dunning Co', 'live', 'curb', 'owner@unittestdunning.test') RETURNING id`,
    [SLUG]
  );
  tenantId = t!.id;
  const s = await controlOne<{ id: string }>(
    `INSERT INTO staff_users (email, name, role, password_hash)
     VALUES ($1, 'Unit Test Staff', 'admin', 'scrypt$unused$unused') RETURNING id`,
    [STAFF_EMAIL]
  );
  staffId = s!.id;
  await controlQuery(
    `INSERT INTO payment_failures (tenant_id, stripe_invoice_id, amount_cents, first_failed_at, last_failed_at, retries, warnings, status)
     VALUES ($1, 'in_unit_test_dunning', 19900, now() - interval '20 days', now() - interval '1 day', 4, '[]', 'open')`,
    [tenantId]
  );
});

afterAll(async () => {
  await controlQuery("DELETE FROM tenants WHERE slug = $1", [SLUG]);
  await controlQuery("DELETE FROM staff_users WHERE email = $1", [STAFF_EMAIL]);
});

describe("D7 / ASSUMPTIONS #44: the suspension human gate", () => {
  it("dunning past day 14 PREPARES a suspension and never flips the tenant", async () => {
    const { prepared } = await runDunning();
    expect(prepared).toBe(1);

    const tenant = await controlOne<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [tenantId]);
    expect(tenant!.status).toBe("live"); // the invariant

    const action = await controlOne<{ id: string }>(
      `SELECT id FROM pending_actions WHERE tenant_id = $1 AND kind = 'suspend_tenant' AND status = 'pending'`,
      [tenantId]
    );
    expect(action).not.toBeNull();

    const failure = await controlOne<{ status: string }>(
      "SELECT status FROM payment_failures WHERE tenant_id = $1",
      [tenantId]
    );
    expect(failure!.status).toBe("pending_suspension");
  });

  it("running dunning again never stacks a second pending suspension", async () => {
    const { prepared } = await runDunning();
    expect(prepared).toBe(0);
    const count = await controlOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM pending_actions
        WHERE tenant_id = $1 AND kind = 'suspend_tenant' AND status = 'pending'`,
      [tenantId]
    );
    expect(count!.n).toBe(1);
  });

  it("only the staff click suspends — and it audits who", async () => {
    const action = await controlOne<{ id: string }>(
      `SELECT id FROM pending_actions WHERE tenant_id = $1 AND kind = 'suspend_tenant' AND status = 'pending'`,
      [tenantId]
    );
    await approveSuspension(action!.id, { id: staffId, email: STAFF_EMAIL });

    const tenant = await controlOne<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [tenantId]);
    expect(tenant!.status).toBe("suspended");

    const decided = await controlOne<{ status: string; decided_by: string }>(
      "SELECT status, decided_by FROM pending_actions WHERE id = $1",
      [action!.id]
    );
    expect(decided!.status).toBe("approved");
    expect(decided!.decided_by).toBe(staffId);
  });
});
