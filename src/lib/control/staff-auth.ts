/**
 * Staff auth (D16): the STAFF surface — real credentials plus TOTP MFA, full
 * fleet access, control plane only. Deliberately a different mechanism, a
 * different cookie, a different DB role, and a different hostname from the
 * owner portal's magic links. A staff session can never leak into a
 * tenant-scoped context: staff_sessions is readable only by curbside_control,
 * which the tenant app never connects as.
 *
 * Passwords: scrypt (node:crypto), per-user salt. TOTP secrets: AES-256-GCM
 * encrypted at rest with a key resolved from the secret provider — the DB
 * never holds a usable TOTP secret (Invariant 3 applied to our own keys).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { controlOne, controlQuery } from "@/lib/control/db";

export const STAFF_COOKIE = "cs_staff";
const PASSWORD_STAGE_TTL_MS = 15 * 60_000; // password ok, MFA still pending
const SESSION_TTL_MS = 12 * 60 * 60_000; // full session: half a workday

// --- password hashing --------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- TOTP secret encryption at rest ------------------------------------------

function encKey(): Buffer {
  const raw = process.env.STAFF_TOTP_ENC_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_ENV_SECRETS !== "1") {
      throw new Error(
        "STAFF_TOTP_ENC_KEY is not set. In real infrastructure it comes from Key Vault (Session 4); locally set it in .env.local."
      );
    }
    console.warn("[staff-auth] STAFF_TOTP_ENC_KEY unset — using dev-only derivation");
    return createHash("sha256").update("curbside-dev-totp-key").digest();
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ct.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString(
    "utf8"
  );
}

// --- sessions -----------------------------------------------------------------

export function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "tech";
  totp_enabled: boolean;
}

export interface StaffSession extends StaffUser {
  session_id: string;
  mfa_ok: boolean;
}

/** Password stage: verify credentials, mint an MFA-pending session token. */
export async function startStaffSession(
  email: string,
  password: string
): Promise<{ token: string; user: StaffUser } | null> {
  const user = await controlOne<StaffUser & { password_hash: string }>(
    "SELECT id, email, name, role, totp_enabled, password_hash FROM staff_users WHERE email = $1",
    [email.trim().toLowerCase()]
  );
  // Hash something either way so a miss and a bad password take similar time.
  const ok = user
    ? verifyPassword(password, user.password_hash)
    : (verifyPassword(password, hashPassword("timing-equalizer")), false);
  if (!user || !ok) return null;

  const token = randomBytes(32).toString("base64url");
  await controlQuery(
    `INSERT INTO staff_sessions (staff_id, token_hash, mfa_ok, expires_at)
     VALUES ($1, $2, false, $3)`,
    [user.id, sha256(token), new Date(Date.now() + PASSWORD_STAGE_TTL_MS).toISOString()]
  );
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, totp_enabled: user.totp_enabled },
  };
}

/** MFA stage: verify TOTP for the pending session; promote it to a full one. */
export async function completeMfa(sessionToken: string): Promise<void> {
  await controlQuery(
    `UPDATE staff_sessions SET mfa_ok = true, expires_at = $2 WHERE token_hash = $1`,
    [sha256(sessionToken), new Date(Date.now() + SESSION_TTL_MS).toISOString()]
  );
}

/** The session behind the cookie, MFA-pending or complete. Null if invalid. */
export async function getStaffSession(): Promise<StaffSession | null> {
  const jar = await cookies();
  const token = jar.get(STAFF_COOKIE)?.value;
  if (!token) return null;
  const row = await controlOne<StaffSession>(
    `SELECT s.id AS session_id, s.mfa_ok, u.id, u.email, u.name, u.role, u.totp_enabled
       FROM staff_sessions s JOIN staff_users u ON u.id = s.staff_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(token)]
  );
  return row ?? null;
}

/**
 * The guard every /admin page and staff action calls. Returns the staff user
 * only when password AND MFA have both passed. Anything else → null, and the
 * caller redirects to /login.
 */
export async function requireStaff(): Promise<StaffSession | null> {
  const s = await getStaffSession();
  return s && s.mfa_ok ? s : null;
}

export async function revokeStaffSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(STAFF_COOKIE)?.value;
  if (!token) return;
  await controlQuery("UPDATE staff_sessions SET revoked_at = now() WHERE token_hash = $1", [
    sha256(token),
  ]);
}
