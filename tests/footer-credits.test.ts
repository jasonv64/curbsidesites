/**
 * Invariant 11 tripwire: every footer-credit target must return 200 against
 * PRODUCTION. Four of five silently 404'd for weeks (the marketing pages
 * were never built) — mass links to dead pages from every tenant footer is
 * the exact link-scheme-adjacent footprint the invariant exists to avoid.
 * This test makes the next dead target fail loudly instead of silently.
 *
 * Deliberately a live network check: the thing being asserted is production
 * reality, not code shape. Redirects (apex → canonical host) count as alive;
 * what matters is where the visitor lands.
 */
import { describe, expect, it } from "vitest";
import { CREDITS } from "../src/components/site/footer";

describe("Invariant 11: footer credit targets are alive", () => {
  it("has five distinct anchor texts (the anti-footprint part)", () => {
    expect(new Set(CREDITS.map((c) => c.text)).size).toBe(CREDITS.length);
  });

  for (const { text, href } of CREDITS) {
    it(`"${text}" → ${href} returns 200`, async () => {
      const res = await fetch(href, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
      expect(res.status, `${href} resolved to ${res.url}`).toBe(200);
    });
  }
});
