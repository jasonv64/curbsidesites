import { Client } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

export const IRON = "iron-ridge-offroad";
export const DELTA = "delta-marine-service";
export const host = (slug: string) => `${slug}.localhost`;
export const url = (slug: string, path = "/") => `http://${host(slug)}:3000${path}`;

export const PAGES = ["/", "/services", "/about", "/gallery", "/contact", "/blog", "/privacy", "/terms", "/accessibility"];

/** Owner-role DB access for test fixtures only. */
export async function ownerDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export async function tenantId(slug: string): Promise<string> {
  return ownerDb(async (db) => {
    const { rows } = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
    if (!rows[0]) throw new Error(`tenant ${slug} not seeded`);
    return rows[0].id;
  });
}

/**
 * Mint a REAL portal session through the same table the app checks — the
 * mechanism under test stays the production mechanism; only the email step
 * is skipped (its token never leaves the email adapter).
 */
export async function mintPortalSession(slug: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await ownerDb((db) =>
    db.query(
      `INSERT INTO portal_sessions (tenant_id, email, token_hash, expires_at)
       SELECT id, COALESCE(owner_email, 'e2e@test'), $2, now() + interval '1 hour'
         FROM tenants WHERE slug = $1`,
      [slug, hash]
    )
  );
  return token;
}

export async function cleanupE2E(): Promise<void> {
  await ownerDb(async (db) => {
    await db.query("DELETE FROM leads WHERE name LIKE 'E2E %'");
    await db.query("DELETE FROM subscribers WHERE email LIKE 'e2e-%'");
    await db.query("DELETE FROM events WHERE payload->>'e2e' = '1'");
    await db.query("DELETE FROM portal_sessions WHERE email = 'e2e@test'");
    await db.query("DELETE FROM tenants WHERE slug = 'bare-demo'");
  });
}
