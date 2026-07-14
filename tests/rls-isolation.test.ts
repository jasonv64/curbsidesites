/**
 * THE cross-tenant isolation gate (D4, TENANT-APP Part 3).
 *
 * If this file is ever deleted or skipped, the build must fail — CI runs
 * `npm run test:rls` unconditionally, and D4 says the platform is not done
 * if application code is the only thing preventing a leak.
 *
 * Two attack paths, both must return ZERO cross-tenant rows:
 *   1. Application code explicitly querying another tenant's rows.
 *   2. A deliberately malformed query that OMITS the tenant filter entirely.
 * Plus: no tenant context at all → zero rows; cross-tenant writes rejected.
 *
 * Everything here runs as curbside_app — the role the real app uses — against
 * the real database. Postgres RLS is the thing under test, not our code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { withTenant, platformQuery } from "@/lib/db";

let ironId: string;
let deltaId: string;
let owner: Client;

beforeAll(async () => {
  // Look up the two seeded tenants through the app's own platform query path.
  const tenants = await platformQuery<{ id: string; slug: string }>(
    "SELECT id, slug FROM tenants WHERE slug IN ('iron-ridge-offroad','delta-marine-service')"
  );
  ironId = tenants.find((t) => t.slug === "iron-ridge-offroad")!.id;
  deltaId = tenants.find((t) => t.slug === "delta-marine-service")!.id;
  expect(ironId).toBeTruthy();
  expect(deltaId).toBeTruthy();

  // Owner connection only to verify test preconditions (RLS-bypassing role).
  owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await owner.connect();
});

afterAll(async () => {
  await owner.end();
});

describe("cross-tenant isolation (D4)", () => {
  it("precondition: both tenants really have leads", async () => {
    const { rows } = await owner.query(
      "SELECT tenant_id, count(*)::int AS n FROM leads WHERE tenant_id IN ($1,$2) GROUP BY tenant_id",
      [ironId, deltaId]
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.n).toBeGreaterThan(0);
  });

  it("attack 1: explicit cross-tenant read from application code → zero rows", async () => {
    const stolen = await withTenant(ironId, (db) =>
      db.query("SELECT * FROM leads WHERE tenant_id = $1", [deltaId])
    );
    expect(stolen).toHaveLength(0);
  });

  it("attack 2: malformed query omitting the tenant filter → zero foreign rows", async () => {
    const all = await withTenant(ironId, (db) => db.query("SELECT tenant_id FROM leads"));
    expect(all.length).toBeGreaterThan(0); // own rows still visible
    const foreign = all.filter((r) => r.tenant_id !== ironId);
    expect(foreign).toHaveLength(0);
  });

  it("no tenant context at all → zero rows from every tenant-scoped table", async () => {
    for (const table of [
      "leads", "reviews", "subscribers", "content", "services", "sections",
      "images", "integrations", "events", "change_requests", "business_profile",
      "brand", "magic_links", "portal_sessions",
    ]) {
      const rows = await platformQuery(`SELECT * FROM ${table} LIMIT 5`);
      expect(rows, `${table} leaked rows without a tenant context`).toHaveLength(0);
    }
  });

  it("cross-tenant INSERT is rejected by WITH CHECK", async () => {
    await expect(
      withTenant(ironId, (db) =>
        db.query(
          "INSERT INTO leads (tenant_id, name, contact, message) VALUES ($1, 'Mallory', '{}', 'stolen row')",
          [deltaId]
        )
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("cross-tenant UPDATE touches zero rows", async () => {
    const updated = await withTenant(ironId, (db) =>
      db.query("UPDATE leads SET status = 'won' WHERE tenant_id = $1 RETURNING id", [deltaId])
    );
    expect(updated).toHaveLength(0);
  });

  it("the app role cannot bypass RLS (NOBYPASSRLS, not superuser)", async () => {
    const { rows } = await owner.query(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'curbside_app'"
    );
    expect(rows[0].rolbypassrls).toBe(false);
    expect(rows[0].rolsuper).toBe(false);
  });

  it("tenant context uses SET LOCAL semantics: gone after the transaction", async () => {
    // Run a tenant transaction, then immediately query with no context on the
    // same pool — if SET (session) had leaked, this would return rows.
    await withTenant(ironId, (db) => db.query("SELECT 1"));
    const after = await platformQuery("SELECT * FROM leads LIMIT 1");
    expect(after).toHaveLength(0);
  });
});
