/**
 * D22 + the is_primary/export fixes (02-BUILD-PROMPT Session 1):
 *   - registrableDomain/isApex — where email auth records live; the apex branch
 *   - registrarInstructions branches on apex-vs-subdomain and registrar
 *     flattening; www instructions carry the HTTPS apex-forward
 *   - provisionDomain refuses an apex on a known non-flattening registrar,
 *     carries the registrar forward across release→re-provision, and demotes
 *     the old primary
 *   - releaseDomains clears is_primary
 *   - the partial unique index makes two primaries unrepresentable
 *
 * DB tests run on the control role against the real dev database, on a
 * scratch tenant created and removed here (same convention as the e2e suite).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isApex,
  provisionDomain,
  registrableDomain,
  registrarInstructions,
  releaseDomains,
} from "../src/lib/control/domains";
import { controlOne, controlQuery } from "../src/lib/control/db";

const SLUG = "unit-test-domains-co";
let tenantId = "";

beforeAll(async () => {
  await controlQuery("DELETE FROM tenants WHERE slug = $1", [SLUG]);
  const row = await controlOne<{ id: string }>(
    `INSERT INTO tenants (slug, business_name, status, plan_tier, owner_email)
     VALUES ($1, 'Unit Test Domains Co', 'draft', 'curb', 'owner@unittestdomains.test') RETURNING id`,
    [SLUG]
  );
  tenantId = row!.id;
});

afterAll(async () => {
  await controlQuery("DELETE FROM tenants WHERE slug = $1", [SLUG]);
});

describe("registrableDomain / isApex", () => {
  it("strips the www host down to where DMARC actually lives", () => {
    expect(registrableDomain("www.dubdating.com")).toBe("dubdating.com");
    expect(registrableDomain("dubdating.com")).toBe("dubdating.com");
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
  });
  it("knows an apex from a subdomain", () => {
    expect(isApex("dubdating.com")).toBe(true);
    expect(isApex("www.dubdating.com")).toBe(false);
    expect(isApex("example.co.uk")).toBe(true);
  });
});

describe("registrarInstructions (D22 branches)", () => {
  const targets = [
    { type: "CNAME", name: "dubdating.com", value: "sites-origin.curbsidesites.com" },
    { type: "TXT", name: "_cf-custom-hostname.dubdating.com", value: "tok" },
  ];

  it("www hostname: includes the HTTPS apex-forward step", () => {
    const text = registrarInstructions("GoDaddy", "www.dubdating.com", [
      { type: "CNAME", name: "www.dubdating.com", value: "sites-origin.curbsidesites.com" },
    ]);
    expect(text).toContain("https://www.dubdating.com");
    expect(text).toContain("301");
    expect(text).toMatch(/must start with https/);
  });

  it("apex on a flattening registrar: notes the capability instead of a caveat", () => {
    const text = registrarInstructions("Cloudflare", "dubdating.com", targets);
    expect(text).toContain("flattens CNAME");
    expect(text).not.toContain("If yours refuses it");
  });

  it("apex on an unknown registrar: carries the honest caveat + www alternative", () => {
    const text = registrarInstructions(null, "dubdating.com", targets);
    expect(text).toContain("won't accept a CNAME on the bare domain");
    expect(text).toContain("www.dubdating.com");
    expect(text).toContain("https://www.dubdating.com");
  });
});

describe("provisionDomain / releaseDomains (demo hostname provider)", () => {
  it("refuses an apex on a known non-flattening registrar, naming the fix", async () => {
    await controlQuery(
      `INSERT INTO domains (tenant_id, hostname, registrar, verification_status)
       VALUES ($1, 'unittestdomains.com', 'GoDaddy', 'unmanaged')`,
      [tenantId]
    );
    await expect(provisionDomain(tenantId, "unittestdomains.com", "unit-test")).rejects.toThrow(
      /www\.unittestdomains\.com/
    );
  });

  it("release → re-provision: registrar carries forward, primary flips exactly once", async () => {
    // Provision the www host (allowed on GoDaddy) — becomes primary.
    await provisionDomain(tenantId, "www.unittestdomains.com", "unit-test");
    let rows = await controlQuery<{ hostname: string; is_primary: boolean; registrar: string | null; verification_status: string }>(
      "SELECT hostname, is_primary, registrar, verification_status FROM domains WHERE tenant_id = $1 ORDER BY hostname",
      [tenantId]
    );
    const www = rows.find((r) => r.hostname === "www.unittestdomains.com")!;
    expect(www.is_primary).toBe(true);
    expect(www.registrar).toBe("GoDaddy"); // carried forward, not NULL (D22b)
    expect(rows.filter((r) => r.is_primary)).toHaveLength(1);

    // Release everything: nothing may stay primary (the export bug's root).
    await releaseDomains(tenantId, "unit-test");
    rows = await controlQuery("SELECT hostname, is_primary, verification_status FROM domains WHERE tenant_id = $1", [tenantId]);
    expect(rows.every((r) => r.is_primary === false)).toBe(true);
    expect(rows.every((r) => r.verification_status === "released")).toBe(true);

    // Re-provision after release (the dub-dates swap): registrar still known.
    await provisionDomain(tenantId, "www.unittestdomains.com", "unit-test");
    rows = await controlQuery(
      "SELECT hostname, is_primary, registrar FROM domains WHERE tenant_id = $1 AND is_primary",
      [tenantId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].registrar).toBe("GoDaddy");
  });

  it("two primary domains are unrepresentable (migration 006 partial unique index)", async () => {
    await expect(
      controlQuery(
        `INSERT INTO domains (tenant_id, hostname, is_primary, verification_status)
         VALUES ($1, 'second-primary.unittestdomains.com', true, 'pending')`,
        [tenantId]
      )
    ).rejects.toThrow(/domains_one_primary_per_tenant/);
  });
});
