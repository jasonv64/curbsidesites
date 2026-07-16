/**
 * The accessibility build gate (D12): axe against every rendered page of both
 * demo tenants, WITH each tenant's real brand tokens. Violations fail the
 * build. Contrast is exactly the check a template-level pass would miss —
 * that's why it runs per tenant.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { IRON, DELTA, PAGES, url } from "./helpers";

const TENANT_PAGES: [string, string][] = [];
for (const slug of [IRON, DELTA]) {
  for (const path of [...PAGES, "/portal"]) TENANT_PAGES.push([slug, path]);
}
TENANT_PAGES.push([IRON, "/blog/leveling-kit-vs-lift-kit"]);
TENANT_PAGES.push([DELTA, "/blog/annual-outboard-service-checklist"]);

for (const [slug, path] of TENANT_PAGES) {
  test(`axe: ${slug}${path} has zero violations`, async ({ page }) => {
    await page.goto(url(slug, path));
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.length} nodes — ${v.help}`
    );
    expect(summary, summary.join("\n")).toHaveLength(0);
  });
}

// The monthly report artifact (GROWTH Part 5) is its own rendered surface —
// the same HTML serves the portal iframe, the email, and the PDF, so it goes
// through the same gate. Needs the seeded sample: npm run db:seed:growth.
test("axe: the monthly report artifact has zero violations", async ({ page }) => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  let html: string;
  try {
    const dir = join(process.cwd(), ".data", "reports", IRON);
    const newest = readdirSync(dir).filter((f) => f.endsWith("-sample.html")).sort().at(-1);
    if (!newest) throw new Error("no sample");
    html = readFileSync(join(dir, newest), "utf8");
  } catch {
    test.skip(true, "no sample report on disk — run npm run db:seed:growth first");
    return;
  }
  await page.setContent(html);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} nodes — ${v.help}`);
  expect(summary, summary.join("\n")).toHaveLength(0);
});
