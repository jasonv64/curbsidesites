/**
 * Control-plane data access. THE ONLY FILE THAT TOUCHES THE CONTROL POOL.
 *
 * Connects as curbside_control — a second NOBYPASSRLS role whose cross-tenant
 * reach comes from explicit RLS policies (migrations/002). The tenant app's
 * pool (src/lib/db.ts, curbside_app) and this one are deliberately separate
 * surfaces (D16): a bug in a tenant-facing page can never write a tenants row
 * or read a staff session, because its ROLE can't — not because our code
 * remembered not to.
 *
 * Use this ONLY from: /admin routes, /platform (intake) routes, /api/stripe,
 * /api/jobs, and scripts. Never from anything under src/app/s/[host].
 */
import { Pool, types } from "pg";

types.setTypeParser(1700, (v) => parseFloat(v));

declare global {
  var __curbsideControlPool: Pool | undefined;
}

function pool(): Pool {
  if (!global.__curbsideControlPool) {
    const url = process.env.DATABASE_URL_CONTROL;
    if (!url) throw new Error("DATABASE_URL_CONTROL is not set (see .env.example)");
    if (!/curbside_control/.test(url)) {
      throw new Error(
        "DATABASE_URL_CONTROL must connect as curbside_control — not the app or owner role (D16)."
      );
    }
    global.__curbsideControlPool = new Pool({ connectionString: url, max: 5 });
  }
  return global.__curbsideControlPool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Single cross-tenant query on the control role. */
export async function controlQuery<T extends Row = Row>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  return (await pool().query(text, params as unknown[])).rows;
}

export async function controlOne<T extends Row = Row>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  return (await pool().query(text, params as unknown[])).rows[0] ?? null;
}

export interface ControlDb {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  one<T extends Row = Row>(text: string, params?: unknown[]): Promise<T | null>;
}

/**
 * Transaction on the control role. The onboarding pipeline runs in exactly
 * one of these: either the whole tenant exists or none of it does.
 */
export async function controlTx<T>(fn: (db: ControlDb) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const db: ControlDb = {
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
      /* connection may be gone */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Invalidate a tenant's render-bundle cache after a control-plane write.
 * Inside Next this revalidates the tag; in a tsx script (jobs, seeds) there
 * is no cache to revalidate — the dynamic import fails and we no-op, which is
 * correct: the running server's 600s window still applies (README: ISR
 * windows), and status flips don't need it (the tenant row rides fresh).
 */
export async function revalidateTenant(slug: string): Promise<void> {
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag(`tenant:${slug}`, "max");
  } catch {
    /* script context — nothing to revalidate */
  }
}

/** Append to the control-plane audit log. */
export async function audit(
  actor: string,
  tenantId: string | null,
  action: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await controlQuery(
    "INSERT INTO audit_log (actor, tenant_id, action, detail) VALUES ($1, $2, $3, $4)",
    [actor, tenantId, action, JSON.stringify(detail)]
  );
}
