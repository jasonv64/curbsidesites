/**
 * Control-plane verification (CONTROL-PLANE Part 12):
 *
 *   12.2 — the WHOLE onboarding pipeline end to end against a fake business:
 *          public form → draft tenant → browsable preview → brand gate →
 *          human approval → live. If a human had to touch a database for any
 *          of this, the test fails, because the test doesn't touch one
 *          (ownerDb below is used for FIXTURES and ASSERTIONS only).
 *   12.4 — the content pipeline REFUSES an unconsented transcript.
 *   12.5 — suspend → under-construction → restore intact, via staff actions.
 *
 * Staff auth is exercised for real: password stage, TOTP enrollment from the
 * on-screen key, and code verification — the same RFC 6238 math, reimplemented
 * here so the test proves interop rather than importing the app's own code.
 */
import { test, expect, type Page } from "@playwright/test";
import { createHmac, randomBytes, scryptSync } from "node:crypto";
import { ownerDb } from "./helpers";

const BIZ_NAME = "E2E Test Plumbing Co";
const SLUG = "e2e-test-plumbing-co";
const STAFF_EMAIL = "e2e-staff@curbsidesites.test";
const STAFF_PASSWORD = "e2e-staff-password-1";

let totpSecret = ""; // captured during enrollment, reused for later logins
let staffCookie = ""; // one operator session reused across tests (12h TTL; also
// keeps the suite clear of the staff-login rate limit, 5 attempts / 10 min)

// --- independent TOTP implementation (interop check) -------------------------
function base32Decode(s: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret: string): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, "0");
}

async function staffLogin(page: Page): Promise<void> {
  if (staffCookie) {
    await page.context().addCookies([
      { name: "cs_staff", value: staffCookie, domain: "admin.localhost", path: "/" },
    ]);
    await page.goto("http://admin.localhost:3000/");
    await expect(page.locator("h1")).toContainText("Fleet");
    return;
  }
  await page.goto("http://admin.localhost:3000/login");
  await page.fill("#email", STAFF_EMAIL);
  await page.fill("#password", STAFF_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector("#code");
  // A fresh staff user lands on enrollment — capture the on-screen key so
  // each test can authenticate independently of the others' outcomes.
  const enrollKey = page.getByText("Manual entry key:");
  if (await enrollKey.count()) {
    totpSecret = (await enrollKey.textContent())!.replace("Manual entry key:", "").trim();
  }
  await page.fill("#code", totpNow(totpSecret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.locator("h1")).toContainText("Fleet");
  staffCookie = (await page.context().cookies("http://admin.localhost:3000")).find((c) => c.name === "cs_staff")!.value;
}

test.beforeAll(async () => {
  await ownerDb(async (db) => {
    await db.query("DELETE FROM tenants WHERE slug LIKE $1", [`${SLUG}%`]);
    await db.query("DELETE FROM staff_users WHERE email = $1", [STAFF_EMAIL]);
    const salt = randomBytes(16);
    const hash = `scrypt$${salt.toString("base64")}$${scryptSync(STAFF_PASSWORD, salt, 64).toString("base64")}`;
    await db.query(
      "INSERT INTO staff_users (email, name, role, password_hash) VALUES ($1, 'E2E Staff', 'admin', $2)",
      [STAFF_EMAIL, hash]
    );
  });
});

test.afterAll(async () => {
  await ownerDb(async (db) => {
    await db.query("DELETE FROM tenants WHERE slug LIKE $1", [`${SLUG}%`]);
    await db.query("DELETE FROM staff_users WHERE email = $1", [STAFF_EMAIL]);
    // restore fixtures the suspend/restore test may have left mid-state
    await db.query("UPDATE tenants SET status = 'live' WHERE slug = 'sunrise-pool-care'");
  });
});

test("12.2a: public intake form → immediately browsable draft tenant, zero human DB access", async ({ page }) => {
  await page.goto("http://localhost:3000/onboard");
  await expect(page.locator("h1")).toContainText("Tell us about your business");

  await page.fill("#business_name", BIZ_NAME);
  await page.selectOption("#industry", "plumbing");
  await page.fill("#street", "42 Test Lane");
  await page.fill("#city", "Bakersfield");
  await page.fill("#postal", "93301");
  await page.fill("#phone", "(661) 555-0142");
  await page.fill("#email", "owner@e2etestplumbing.test");
  await page.fill("#service_area", "Bakersfield, Oildale");
  await page.locator('input[name="service_name"]').first().fill("Drain Cleaning");
  await page.locator('input[name="service_blurb"]').first().fill("Clogs cleared same-day.");
  await page.fill("#voice", "Family shop, twenty years in Bakersfield. We answer our own phones and we don't upsell grandma on a repipe she doesn't need.");
  await page.check('input[name="consent_terms"]');
  await page.check('input[name="consent_recording"]');
  await page.getByRole("button", { name: "Start my site" }).click();

  const previewLink = page.getByRole("link", { name: /Open your private preview/ });
  await expect(previewLink).toBeVisible({ timeout: 20_000 });
  const previewUrl = await previewLink.getAttribute("href");
  expect(previewUrl).toContain(`${SLUG}.localhost:3000`);
  expect(previewUrl).toContain("preview=");

  // The sales artifact: browsable NOW, noindex, on the platform subdomain.
  await page.goto(previewUrl!);
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("body")).toContainText(BIZ_NAME);
  expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);

  // The form's output is database rows — all of them, from one submission.
  const rows = await ownerDb(async (db) => {
    const t = (await db.query("SELECT id, status FROM tenants WHERE slug = $1", [SLUG])).rows[0];
    expect(t?.status).toBe("draft");
    const count = async (sql: string) => (await db.query(sql, [t.id])).rows[0].n;
    return {
      consents: await count("SELECT count(*)::int AS n FROM consents WHERE tenant_id = $1"),
      proposals: await count("SELECT count(*)::int AS n FROM brand_proposals WHERE tenant_id = $1 AND status = 'proposed'"),
      calls: await count("SELECT count(*)::int AS n FROM onboarding_calls WHERE tenant_id = $1"),
      intake: await count("SELECT count(*)::int AS n FROM intake_submissions WHERE tenant_id = $1"),
      integrations: await count("SELECT count(*)::int AS n FROM integrations WHERE tenant_id = $1"),
      services: await count("SELECT count(*)::int AS n FROM services WHERE tenant_id = $1"),
    };
  });
  expect(rows.consents).toBe(2); // terms + recording (distinct checkboxes)
  expect(rows.proposals).toBe(1);
  expect(rows.calls).toBe(1);
  expect(rows.intake).toBe(1);
  expect(rows.integrations).toBe(11);
  expect(rows.services).toBe(1);
});

test("12.2b: staff MFA login → brand gate blocks go-live → approval → live", async ({ page, request }) => {
  // First login: password stage, then forced TOTP enrollment from the on-screen key.
  await page.goto("http://admin.localhost:3000/login");
  await page.fill("#email", STAFF_EMAIL);
  await page.fill("#password", STAFF_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Manual entry key:")).toBeVisible();
  totpSecret = (await page.getByText("Manual entry key:").textContent())!.replace("Manual entry key:", "").trim();
  await page.fill("#code", totpNow(totpSecret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.locator("h1")).toContainText("Fleet");
  staffCookie = (await page.context().cookies("http://admin.localhost:3000")).find((c) => c.name === "cs_staff")!.value;

  // The tenant the intake test created, in the fleet table.
  await page.goto(`http://admin.localhost:3000/tenants/${SLUG}`);
  await expect(page.locator("h1")).toContainText(BIZ_NAME);

  // Gate order matters: go-live REFUSES before the brand gate passes.
  await page.getByLabel(/platform subdomain only/).check();
  await page.getByRole("button", { name: "Flip live" }).click();
  await expect(page.getByText(/brand gate: latest proposal is not approved/)).toBeVisible();

  // A human looks, then approves (2.3).
  await page.getByRole("button", { name: /Approve — I looked at it/ }).click();
  await expect(page.getByText("Status: approved")).toBeVisible();

  // Now the flip goes through (forced: no custom domain yet).
  await page.getByLabel(/platform subdomain only/).check();
  await page.getByRole("button", { name: "Flip live" }).click();
  await expect(page.getByText("Tenant is LIVE.")).toBeVisible();

  // Live means publicly browsable WITHOUT the preview token.
  const publicRes = await request.get(`http://127.0.0.1:3000/`, {
    headers: { Host: `${SLUG}.localhost` },
  });
  expect(publicRes.status()).toBe(200);
  expect(await publicRes.text()).toContain(BIZ_NAME);
});

test("12.4: content pipeline refuses the unconsented transcript, in the operator's face", async ({ page }) => {
  await staffLogin(page);
  // bayside-detailing is seeded with a transcript and NO recording consent.
  await page.goto("http://admin.localhost:3000/tenants/bayside-detailing");
  await page.getByRole("button", { name: /Seed content/ }).click();
  await expect(page.getByText(/NO active written recording consent/)).toBeVisible({ timeout: 15_000 });
  // And it wrote nothing.
  const drafts = await ownerDb(async (db) =>
    (await db.query(
      "SELECT count(*)::int AS n FROM content WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'bayside-detailing')"
    )).rows[0].n
  );
  expect(drafts).toBe(0);
});

test("12.5: staff suspend → under-construction everywhere → restore intact", async ({ page, request }) => {
  await staffLogin(page);
  await page.goto("http://admin.localhost:3000/tenants/sunrise-pool-care");
  await page.getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByText("sunrise-pool-care · suspended")).toBeVisible();

  // Assert on the RENDERED page: the under-construction screen and nothing
  // else visible. (The raw HTML still carries the marketing page's RSC flight
  // payload — Session 1's layout-level gate; public content only, noted in
  // ASSUMPTIONS #45.)
  for (const path of ["/", "/services", "/contact"]) {
    await page.goto(`http://sunrise-pool-care.localhost:3000${path}`);
    await expect(page.getByText("getting some work done"), path).toBeVisible();
    await expect(page.getByText("Weekly Pool Service"), path).toHaveCount(0);
  }

  await page.goto("http://admin.localhost:3000/tenants/sunrise-pool-care");
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("sunrise-pool-care · live")).toBeVisible();
  const back = await request.get("http://127.0.0.1:3000/", {
    headers: { Host: "sunrise-pool-care.localhost" },
  });
  expect(await back.text()).toContain("Sunrise Pool Care");
});
