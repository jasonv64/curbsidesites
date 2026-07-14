/**
 * Forward-only migration runner. Runs as curbside_owner (DATABASE_URL_OWNER).
 *
 * - Ensures the curbside_app role exists, can log in, and CANNOT bypass RLS.
 * - Applies migrations/*.sql in filename order, once each, recorded in
 *   schema_migrations. Never edit a shipped migration; add a new file.
 *
 * Usage: npm run db:migrate
 */
import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set (see .env.example)");
  const appPassword = process.env.APP_DB_PASSWORD ?? "curbside_app_dev";

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    // Role bootstrap — idempotent. NOBYPASSRLS is the load-bearing part (D4).
    const { rows: roles } = await db.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'curbside_app'"
    );
    if (roles.length === 0) {
      await db.query(`CREATE ROLE curbside_app LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${appPassword.replace(/'/g, "''")}'`);
      console.log("created role curbside_app");
    } else {
      await db.query(`ALTER ROLE curbside_app LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${appPassword.replace(/'/g, "''")}'`);
    }

    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const applied = new Set(
      (await db.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename)
    );
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`applying ${file} ...`);
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }
    }
    console.log("migrations up to date");
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
