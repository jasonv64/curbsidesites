/**
 * Data access layer. THE ONLY FILE THAT TOUCHES THE CONNECTION POOL.
 *
 * Design requirement from TENANT-APP Part 3: acquiring a tenant-scoped client
 * and opening a transaction are the same operation and cannot be done
 * separately. There is no exported way to get a raw client.
 *
 * - withTenant(tenantId, fn): BEGIN → set_config('app.tenant_id', id, true)
 *   (the parameterized form of SET LOCAL — transaction-scoped, so a pooled
 *   connection can never leak one request's tenant onto the next) → fn →
 *   COMMIT. RLS does the enforcement; this layer just sets the context.
 *
 * - platformQuery(sql, params): tenant-context-free queries. The app role's
 *   RLS policies only allow this to see the two routing tables (tenants,
 *   domains). Any tenant-scoped table queried here returns zero rows — by
 *   design, not by convention.
 */
import { Pool, types } from "pg";

// numeric → number (ratings). Safe at our scale; revisit if money lands here.
types.setTypeParser(1700, (v) => parseFloat(v));

declare global {
  var __curbsidePool: Pool | undefined;
}

function pool(): Pool {
  if (!global.__curbsidePool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    if (/curbside_owner/.test(url)) {
      // The owner role bypasses RLS. The app must never run as it.
      throw new Error(
        "DATABASE_URL points at curbside_owner. The app must connect as curbside_app (D4)."
      );
    }
    global.__curbsidePool = new Pool({ connectionString: url, max: 10 });
  }
  return global.__curbsidePool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface TenantDb {
  /** The tenant this transaction is scoped to. */
  readonly tenantId: string;
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  one<T extends Row = Row>(text: string, params?: unknown[]): Promise<T | null>;
}

export async function withTenant<T>(
  tenantId: string,
  fn: (db: TenantDb) => Promise<T>
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new Error(`withTenant: not a tenant UUID: ${JSON.stringify(tenantId)}`);
  }
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL app.tenant_id — parameterized via set_config(..., is_local=true).
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const db: TenantDb = {
      tenantId,
      query: async (text, params) => (await client.query(text, params as unknown[])).rows,
      one: async (text, params) => (await client.query(text, params as unknown[])).rows[0] ?? null,
    };
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may be gone; release below */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Routing-table reads only (tenants, domains). RLS blanks everything else. */
export async function platformQuery<T extends Row = Row>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  return (await pool().query(text, params as unknown[])).rows;
}
