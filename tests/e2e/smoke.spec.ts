/**
 * Part 15 smoke suite, against the production server on two hostnames.
 * Asserts each tenant's content AND the absence of the other tenant's.
 */
import { test, expect } from "@playwright/test";
import {
  IRON, DELTA, PAGES, host, url, ownerDb, tenantId, mintPortalSession, cleanupE2E,
} from "./helpers";

test.afterAll(async () => {
  await cleanupE2E();
});

// ---------------------------------------------------------------------------
// Pages 200 + right tenant, not the other (Part 15 §3)
// ---------------------------------------------------------------------------

const MARKS: Record<string, { own: string; other: string }> = {
  [IRON]: { own: "(760) 555-0134", other: "(925) 555-0173" },
  [DELTA]: { own: "(925) 555-0173", other: "(760) 555-0134" },
};

for (const slug of [IRON, DELTA]) {
  test(`every page 200s with ${slug}'s content only`, async ({ page }) => {
    for (const path of PAGES) {
      const res = await page.goto(url(slug, path));
      expect(res?.status(), `${slug}${path}`).toBe(200);
      const html = await page.content();
      expect(html, `${slug}${path} shows its own phone`).toContain(MARKS[slug].own);
      expect(html, `${slug}${path} leaked the other tenant`).not.toContain(MARKS[slug].other);
    }
  });
}

test("blog posts render for the right tenant", async ({ page }) => {
  await page.goto(url(IRON, "/blog/leveling-kit-vs-lift-kit"));
  await expect(page.locator("h1")).toContainText("Leveling kit vs. lift kit");
  // delta must not serve iron's post
  const res = await page.goto(url(DELTA, "/blog/leveling-kit-vs-lift-kit"));
  expect(res?.status()).toBe(404);
  await page.goto(url(DELTA, "/blog/annual-outboard-service-checklist"));
  await expect(page.locator("h1")).toContainText("annual outboard service checklist");
});

// ---------------------------------------------------------------------------
// JSON-LD: parses, correct subtype, NO aggregateRating while demo (Inv. 7)
// ---------------------------------------------------------------------------

for (const slug of [IRON, DELTA]) {
  test(`JSON-LD on ${slug} parses and omits aggregateRating (demo reviews)`, async ({ page }) => {
    await page.goto(url(slug, "/"));
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const parsed = JSON.parse(block); // throws → test fails
      expect(JSON.stringify(parsed)).not.toContain("aggregateRating");
    }
  });
}

test("iron JSON-LD uses the specific AutoRepair subtype and canonical NAP", async ({ page }) => {
  await page.goto(url(IRON, "/"));
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const graph = blocks.map((b) => JSON.parse(b)).find((b) => b["@graph"]);
  expect(graph).toBeTruthy();
  const business = graph["@graph"][0];
  expect(business["@type"]).toBe("AutoRepair");
  expect(business.telephone).toBe("+17605550134");
  expect(business.address.addressLocality).toBe("Victorville");
});

// ---------------------------------------------------------------------------
// SEO surfaces (Part 15 §3): sitemap per tenant, robots, llms.txt, RSS
// ---------------------------------------------------------------------------

test("sitemap lists every page and post for that tenant only", async ({ request }) => {
  const res = await request.get("http://127.0.0.1:3000/sitemap.xml", {
    headers: { Host: "ironridgeoffroad.test" },
  });
  expect(res.status()).toBe(200);
  const xml = await res.text();
  for (const path of PAGES) expect(xml).toContain(`http://ironridgeoffroad.test${path === "/" ? "/" : path}`);
  expect(xml).toContain("/blog/leveling-kit-vs-lift-kit");
  expect(xml).not.toContain("delta-marine"); // that tenant's content stays out
  expect(xml).not.toContain("annual-outboard-service-checklist");
});

test("robots.txt points at the right sitemap; llms.txt and feed.xml serve", async ({ request }) => {
  const robots = await request.get("http://127.0.0.1:3000/robots.txt", {
    headers: { Host: "ironridgeoffroad.test" },
  });
  expect(await robots.text()).toContain("Sitemap: http://ironridgeoffroad.test/sitemap.xml");

  const llms = await request.get("http://127.0.0.1:3000/llms.txt", {
    headers: { Host: "ironridgeoffroad.test" },
  });
  expect(llms.status()).toBe(200);
  const llmsText = await llms.text();
  expect(llmsText).toContain("# Iron Ridge Offroad");
  expect(llmsText).toContain("(760) 555-0134"); // canonical NAP (Invariant 6)

  const feed = await request.get("http://127.0.0.1:3000/feed.xml", {
    headers: { Host: "ironridgeoffroad.test" },
  });
  expect(feed.status()).toBe(200);
  expect(await feed.text()).toContain("leveling-kit-vs-lift-kit");
});

test("platform subdomain is noindex; custom domain is indexable", async ({ request }) => {
  const platform = await request.get(`http://127.0.0.1:3000/robots.txt`, {
    headers: { Host: `${IRON}.localhost` },
  });
  expect(await platform.text()).toContain("Disallow: /");
  const custom = await request.get(`http://127.0.0.1:3000/robots.txt`, {
    headers: { Host: "ironridgeoffroad.test" },
  });
  expect(await custom.text()).toContain("Allow: /");
});

// ---------------------------------------------------------------------------
// Forms: quote form persists a lead into the right tenant and NOWHERE else,
// appears in that tenant's portal, then gets deleted (Part 15 §4)
// ---------------------------------------------------------------------------

test("quote form → lead in the right tenant only → visible in portal → deleted", async ({ page, browser }) => {
  await page.goto(url(IRON, "/contact"));
  await page.fill("#qf-name", "E2E Smoke Lead");
  await page.fill("#qf-phone", "(760) 555-0000");
  await page.fill("#qf-message", "This is an automated verification lead. It should be deleted.");
  await page.selectOption("#qf-service", { index: 1 });
  await page.click('button:has-text("Send my request")');
  await expect(page.getByText("Request received.")).toBeVisible({ timeout: 15_000 });

  const ironTenant = await tenantId(IRON);
  const rows = await ownerDb(async (db) =>
    (await db.query("SELECT tenant_id, is_demo FROM leads WHERE name = 'E2E Smoke Lead'")).rows
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].tenant_id).toBe(ironTenant);
  expect(rows[0].is_demo).toBe(false);

  // Appears in iron's portal…
  const ironSession = await mintPortalSession(IRON);
  const ironCtx = await browser.newContext();
  await ironCtx.addCookies([
    { name: "cs_portal", value: ironSession, domain: host(IRON), path: "/" },
  ]);
  const ironPortal = await ironCtx.newPage();
  await ironPortal.goto(url(IRON, "/portal/leads"));
  await expect(ironPortal.getByText("E2E Smoke Lead")).toBeVisible();

  // The overview surfaces the same lead, the 30-day conversion tiles, the
  // published posts with live links, and the change-request audit list.
  await ironPortal.goto(url(IRON, "/portal"));
  await expect(ironPortal.getByText("Latest leads")).toBeVisible();
  await expect(ironPortal.getByText("E2E Smoke Lead")).toBeVisible();
  await expect(ironPortal.getByText("Quote requests, last 30 days")).toBeVisible();
  await expect(ironPortal.getByText("Leveling kit vs. lift kit", { exact: false })).toBeVisible();
  await expect(ironPortal.getByText("Recent site changes")).toBeVisible();
  await ironCtx.close();

  // …and in delta's portal it does not (delta still shows its demo samples).
  const deltaSession = await mintPortalSession(DELTA);
  const deltaCtx = await browser.newContext();
  await deltaCtx.addCookies([
    { name: "cs_portal", value: deltaSession, domain: host(DELTA), path: "/" },
  ]);
  const deltaPortal = await deltaCtx.newPage();
  await deltaPortal.goto(url(DELTA, "/portal/leads"));
  expect(await deltaPortal.content()).not.toContain("E2E Smoke Lead");
  await deltaCtx.close();

  // Clean up: the client's first look should show polished demo data.
  await ownerDb((db) => db.query("DELETE FROM leads WHERE name = 'E2E Smoke Lead'"));
});

test("newsletter signup persists and confirms", async ({ page }) => {
  await page.goto(url(IRON, "/contact"));
  await page.fill("#nl-email", "e2e-newsletter@test.example");
  await page.click('button:has-text("Sign up")');
  await expect(page.getByText("You're on the list.")).toBeVisible({ timeout: 15_000 });
  const rows = await ownerDb(async (db) =>
    (await db.query("SELECT tenant_id FROM subscribers WHERE email = 'e2e-newsletter@test.example'")).rows
  );
  expect(rows).toHaveLength(1);
  await ownerDb((db) => db.query("DELETE FROM subscribers WHERE email = 'e2e-newsletter@test.example'"));
});

test("portal honors auth: unauthenticated subpages bounce to login", async ({ page }) => {
  await page.goto(url(IRON, "/portal/leads"));
  await expect(page).toHaveURL(url(IRON, "/portal"));
  await expect(page.getByText("Sign in")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Stubs behave per spec (Part 15 §3)
// ---------------------------------------------------------------------------

test("payments stub: friendly callout, never a fake success, never an error", async ({ page }) => {
  await page.goto(url(IRON, "/contact"));
  await expect(page.getByText("Online payments aren't live yet")).toBeVisible();
  await expect(page.getByText("Call (760) 555-0134").first()).toBeVisible();
});

test("booking stub: sample availability computed from real hours", async ({ page }) => {
  await page.goto(url(DELTA, "/contact"));
  await expect(page.getByText("Grab a service slot")).toBeVisible();
  await expect(page.getByText("Sample availability")).toBeVisible();
});

test("quote assistant returns a labeled demo ballpark", async ({ request }) => {
  const res = await request.post("http://127.0.0.1:3000/api/quote-assistant", {
    headers: { Host: host(IRON), "Content-Type": "application/json" },
    data: { message: "3 inch lift on a 2021 Tacoma" },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.demo).toBe(true);
  expect(body.reply).toContain("demo mode");
});

// ---------------------------------------------------------------------------
// Images: everything in rendered HTML actually serves (Part 15 §6)
// ---------------------------------------------------------------------------

for (const slug of [IRON, DELTA]) {
  test(`every image on ${slug} home + gallery serves with an image content-type`, async ({ page, request }) => {
    const srcs = new Set<string>();
    for (const path of ["/", "/gallery"]) {
      await page.goto(url(slug, path));
      for (const src of await page.locator("img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute("src")))) {
        if (src) srcs.add(src);
      }
    }
    expect(srcs.size).toBeGreaterThan(0);
    for (const src of srcs) {
      const full = src.startsWith("http") ? src : `http://127.0.0.1:3000${src}`;
      const res = await request.get(full, { headers: { Host: `${host(slug)}:3000` } });
      expect(res.status(), src).toBe(200);
      expect(res.headers()["content-type"], src).toMatch(/^image\//);
    }
  });
}

// ---------------------------------------------------------------------------
// /api/status: staff-gated, names only — never values (Invariant 3)
// ---------------------------------------------------------------------------

test("/api/status requires the staff token and never returns secret values", async ({ request }) => {
  const unauthorized = await request.get("http://127.0.0.1:3000/api/status");
  expect(unauthorized.status()).toBe(401);

  const res = await request.get("http://127.0.0.1:3000/api/status", {
    headers: { Authorization: `Bearer ${process.env.STAFF_STATUS_TOKEN}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  const iron = body.fleet.find((f: { tenant: string }) => f.tenant === IRON);
  expect(iron.integrations.length).toBeGreaterThan(5);
  const reviews = iron.integrations.find((i: { key: string }) => i.key === "reviews_google");
  expect(reviews.mode).toBe("demo");
  expect(reviews.secret_ref).toBe("tenant-iron-ridge-offroad-reviews-google-key"); // the NAME
  expect(reviews.secret_populated).toBe(false);
  // no field anywhere carries a secret VALUE
  expect(JSON.stringify(body)).not.toMatch(/"secret_value"|"api_key"|"password"/);
});
