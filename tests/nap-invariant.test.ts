/**
 * THE NAP INVARIANT, AS A TEST (Invariant 6 / GROWTH-PLANE Parts 4 & 10.6).
 *
 * Dynamic number insertion may change the number a PAGE renders — and nothing
 * else. JSON-LD, llms.txt, and every generated citation string carry the
 * canonical NAP even when call tracking is LIVE with a different number.
 * Get this wrong and the SEO product sabotages the SEO product.
 *
 * Pure fixtures, no DB: the SEO builders and the DNI adapter are functions.
 */
import { describe, it, expect } from "vitest";
import { localBusinessJsonLd, llmsTxt } from "@/lib/seo";
import { getDisplayNumber } from "@/lib/adapters/call-tracking";
import type { TenantBundle } from "@/lib/tenant";

const CANONICAL_DISPLAY = "(760) 555-0134";
const CANONICAL_TEL = "+17605550134";
const DNI_DISPLAY = "(760) 555-9999";
const DNI_TEL = "+17605559999";

function bundleWithLiveDni(): TenantBundle {
  return {
    tenant: {
      id: "00000000-0000-0000-0000-000000000001",
      slug: "nap-test",
      business_name: "Iron Ridge Offroad",
      status: "live",
      plan_tier: "curb_pro",
      features: { call_tracking: true },
      owner_email: null,
      preview_token: "x",
    },
    profile: {
      nap: {
        name: "Iron Ridge Offroad",
        street: "14200 Amargosa Rd",
        city: "Victorville",
        region: "CA",
        postal: "92392",
        phone_display: CANONICAL_DISPLAY,
        phone_tel: CANONICAL_TEL,
      },
      hours: { mon: [["08:00", "17:00"]], sat: [["09:00", "14:00"]] },
      geo: null,
      socials: {},
      service_area: ["Victorville", "Apple Valley"],
      schema_subtype: "AutoRepair",
      tagline: "Built for the desert.",
      about: null,
    },
    brand: null,
    services: [
      { id: "s1", slug: "lift-kits", name: "Lift Kits", blurb: "Lifts done right.", body: "", sort_order: 0 },
    ],
    sections: [],
    images: [],
    // Call tracking LIVE with a DIFFERENT number — the dangerous configuration.
    integrations: [
      { key: "call_tracking", mode: "live", config: { dni_display: DNI_DISPLAY, dni_tel: DNI_TEL } },
    ],
  } as unknown as TenantBundle;
}

describe("DNI never alters the NAP in citation surfaces (Invariant 6)", () => {
  const bundle = bundleWithLiveDni();
  const origin = "https://ironridgeoffroad.test";

  it("precondition: rendered pages DO get the tracking number", async () => {
    const dni = await getDisplayNumber(bundle);
    expect(dni.tracked).toBe(true);
    expect(dni.display).toBe(DNI_DISPLAY);
    expect(dni.tel).toBe(DNI_TEL);
  });

  it("JSON-LD carries the canonical number, never the DNI number", () => {
    const jsonld = JSON.stringify(localBusinessJsonLd(bundle, origin, null));
    expect(jsonld).toContain(CANONICAL_TEL);
    expect(jsonld).not.toContain(DNI_TEL);
    expect(jsonld).not.toContain(DNI_DISPLAY);
  });

  it("llms.txt carries the canonical number, never the DNI number", () => {
    const txt = llmsTxt(bundle, origin);
    expect(txt).toContain(CANONICAL_DISPLAY);
    expect(txt).not.toContain(DNI_DISPLAY);
    expect(txt).not.toContain(DNI_TEL);
  });

  it("JSON-LD parses and the business node's telephone is byte-identical to canonical", () => {
    const graph = (localBusinessJsonLd(bundle, origin, null) as { "@graph": { telephone?: string }[] })["@graph"];
    expect(graph[0].telephone).toBe(CANONICAL_TEL);
  });
});
