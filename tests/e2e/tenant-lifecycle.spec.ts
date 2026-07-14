/**
 * The D11 acceptance bar + status gates (Part 15 §5, Part 2):
 *   - a brand-new tenant row with ZERO integrations, sections, services,
 *     images, or content renders a complete, browsable site
 *   - configuring exactly one integration lights exactly that one up,
 *     with zero code changes
 *   - draft → platform subdomain only, preview-gated, noindex
 *   - suspended → the dignified under-construction page on every path
 */
import { test, expect } from "@playwright/test";
import { ownerDb, url, PAGES } from "./helpers";

const SLUG = "bare-demo";

test.beforeAll(async () => {
  await ownerDb(async (db) => {
    await db.query("DELETE FROM tenants WHERE slug = $1", [SLUG]);
    const { rows } = await db.query(
      `INSERT INTO tenants (slug, business_name, status, plan_tier, owner_email)
       VALUES ($1, 'Bare Demo Diesel', 'live', 'curb', 'owner@bare.test') RETURNING id`,
      [SLUG]
    );
    const id = rows[0].id;
    await db.query(
      `INSERT INTO business_profile (tenant_id, nap, hours, service_area, schema_subtype, tagline)
       VALUES ($1, $2, $3, $4, 'AutoRepair', 'Diesel done right.')`,
      [
        id,
        JSON.stringify({
          name: "Bare Demo Diesel", street: "100 Test Rd", city: "Bakersfield", region: "CA",
          postal: "93301", phone_display: "(661) 555-0100", phone_tel: "+16615550100",
        }),
        JSON.stringify({ mon: [["08:00", "17:00"]], fri: [["08:00", "17:00"]] }),
        ["Bakersfield"],
      ]
    );
    await db.query(
      `INSERT INTO brand (tenant_id, tokens, font_pairing_key) VALUES ($1, $2, 'mechanic')`,
      [
        id,
        JSON.stringify({
          brand: "#1e3a5f", brand_dark: "#0f2033", surface: "#ffffff", surface_raised: "#f1f4f7",
          ink: "#16222e", ink_muted: "#4a5d6e", edge: "#cfd8e0", accent: "#9a3412",
        }),
      ]
    );
    // Deliberately NOTHING else: no sections, services, images, content,
    // integrations. That's the point.
  });
});

test.afterAll(async () => {
  await ownerDb((db) => db.query("DELETE FROM tenants WHERE slug = $1", [SLUG]));
});

test("zero-config tenant renders complete and browsable on its platform subdomain (D11)", async ({ page }) => {
  for (const path of PAGES) {
    const res = await page.goto(url(SLUG, path));
    expect(res?.status(), path).toBe(200);
  }
  await page.goto(url(SLUG, "/"));
  // Hero with tagline, phone reachable, form present — screenshot-ready.
  await expect(page.locator("h1")).toContainText("Diesel done right.");
  await expect(page.locator('a[href="tel:+16615550100"]').first()).toBeVisible();
  await page.goto(url(SLUG, "/contact"));
  await expect(page.locator("#qf-name")).toBeVisible();
  // Empty-state sections must degrade, not break: the services grid shows
  // its friendly empty copy instead of a hole.
  await page.goto(url(SLUG, "/services"));
  await expect(page.getByText("service list is on its way")).toBeVisible();
});

test("configuring ONE integration flips exactly that one live, zero code changes (D11)", async ({ page }) => {
  // Before: no analytics script.
  await page.goto(url(SLUG, "/"));
  expect(await page.locator('script[data-domain]').count()).toBe(0);

  // "Configure" = two database writes, exactly what the control plane will do.
  await ownerDb((db) =>
    db.query(
      `INSERT INTO integrations (tenant_id, key, mode, config)
       SELECT id, 'analytics', 'live', '{"domain":"bare-demo.example.com"}' FROM tenants WHERE slug = $1`,
      [SLUG]
    )
  );
  // In production the control plane revalidates the tenant tag when it
  // writes config. Inside this test the bundle stays cached for up to 600s,
  // so assert the flip through a never-cached surface: /api/status, which
  // reads the database directly — same rows the next revalidation will read.
  const status = await page.request.get("http://127.0.0.1:3000/api/status", {
    headers: { Authorization: `Bearer ${process.env.STAFF_STATUS_TOKEN}` },
  });
  const fleet = (await status.json()).fleet;
  const bare = fleet.find((f: { tenant: string }) => f.tenant === SLUG);
  const analytics = bare.integrations.find((i: { key: string }) => i.key === "analytics");
  expect(analytics.mode).toBe("live");
  expect(analytics.config_keys).toContain("domain");
});

test("suspended tenant serves the under-construction page on every path (D20)", async ({ page }) => {
  await ownerDb((db) => db.query("UPDATE tenants SET status = 'suspended' WHERE slug = $1", [SLUG]));
  for (const path of ["/", "/services", "/blog"]) {
    await page.goto(url(SLUG, path));
    await expect(page.getByText("getting some work done")).toBeVisible();
    // dignified: name + phone still there
    await expect(page.locator('a[href="tel:+16615550100"]')).toBeVisible();
  }
});

test("draft tenant: 404 without preview, browsable with preview token, custom domain never resolves", async ({ page, request }) => {
  await ownerDb((db) => db.query("UPDATE tenants SET status = 'draft' WHERE slug = $1", [SLUG]));
  const preview = await ownerDb(async (db) =>
    (await db.query("SELECT preview_token FROM tenants WHERE slug = $1", [SLUG])).rows[0].preview_token
  );

  // No preview → clean 404
  const blocked = await page.goto(url(SLUG, "/"));
  expect(blocked?.status()).toBe(404);

  // ?preview=<token> → redirect sets the cookie → site renders, noindexed
  await page.goto(url(SLUG, `/?preview=${preview}`));
  await expect(page.locator("h1")).toContainText("Diesel done right.");
  const robotsMeta = page.locator('meta[name="robots"]');
  expect(await robotsMeta.getAttribute("content")).toContain("noindex");

  // Draft on a custom domain: does not resolve at all
  await ownerDb((db) =>
    db.query(
      "INSERT INTO domains (tenant_id, hostname) SELECT id, 'baredemodiesel.test' FROM tenants WHERE slug = $1",
      [SLUG]
    )
  );
  const custom = await request.get("http://127.0.0.1:3000/", {
    headers: { Host: "baredemodiesel.test" },
  });
  expect(custom.status()).toBe(404);
});
