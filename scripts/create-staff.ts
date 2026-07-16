/**
 * Create (or reset the password of) one staff user — the production
 * bootstrap. `db:seed:fleet` also creates one, but it drags four demo
 * tenants along with it; real infrastructure wants exactly this and
 * nothing else (RUNBOOK.md Phase 2).
 *
 * TOTP enrollment is forced at first login (D16) — this script only sets
 * the password factor.
 *
 * Usage:
 *   STAFF_ADMIN_PASSWORD=... npm run staff:create -- jason@curbsidesites.com "Jason"
 *   (password generated and printed ONCE if the env var is unset)
 */
import { randomBytes, scryptSync } from "node:crypto";
import { Client } from "pg";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 64).toString("base64")}`;
}

async function main() {
  const email = (process.argv[2] ?? process.env.STAFF_ADMIN_EMAIL ?? "").toLowerCase();
  const name = process.argv[3] ?? email.split("@")[0];
  if (!email.includes("@")) {
    console.error("Usage: npm run staff:create -- <email> [name]");
    process.exit(1);
  }
  const password = process.env.STAFF_ADMIN_PASSWORD ?? randomBytes(9).toString("base64url");

  const db = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await db.connect();
  try {
    await db.query(
      `INSERT INTO staff_users (email, name, role, password_hash)
       VALUES ($1, $2, 'admin', $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [email, name, hashPassword(password)]
    );
    console.log(`staff user ready: ${email}`);
    console.log(
      `password: ${password}${process.env.STAFF_ADMIN_PASSWORD ? " (from STAFF_ADMIN_PASSWORD)" : "  ← GENERATED, save it now"}`
    );
    console.log("TOTP enrollment happens at first login (forced).");
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
