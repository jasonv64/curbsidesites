/**
 * Portal auth (D16): the OWNER surface. Email magic link, short session,
 * scoped to exactly one tenant. No passwords — every password we store is
 * unpaid liability. Staff auth is a different surface (control plane,
 * Session 2) and never conflates with this one.
 *
 * Tokens are random 256-bit values; only their SHA-256 lands in the DB, so a
 * database read can never mint a session.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { withTenant } from "@/lib/db";
import type { TenantBundle } from "@/lib/tenant";
import { sendTenantEmail } from "@/lib/adapters/email";

export const PORTAL_COOKIE = "cs_portal";
const LINK_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 24 * 60 * 60_000; // "short session" — one day

export function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Issue a magic link for the tenant's owner email. Always returns the same
 * message regardless of whether the email matched — no account enumeration.
 */
export async function requestMagicLink(
  bundle: TenantBundle,
  email: string,
  origin: string
): Promise<void> {
  const owner = bundle.tenant.owner_email?.toLowerCase();
  if (!owner || owner !== email.trim().toLowerCase()) return; // silent no-op

  const token = randomBytes(32).toString("base64url");
  await withTenant(bundle.tenant.id, (db) =>
    db.query(
      `INSERT INTO magic_links (tenant_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [bundle.tenant.id, owner, sha256(token), new Date(Date.now() + LINK_TTL_MS).toISOString()]
    )
  );
  await sendTenantEmail(bundle, {
    to: owner,
    subject: `Sign in to your ${bundle.tenant.business_name} site portal`,
    text: [
      `Use this link to sign in (valid for 15 minutes):`,
      "",
      `${origin}/portal/verify?token=${token}`,
      "",
      `If you didn't request this, ignore it — nothing happens without the link.`,
    ].join("\n"),
  });
}

/** Verify a link token → mint a session. Returns the session cookie value. */
export async function redeemMagicLink(
  tenantId: string,
  token: string
): Promise<string | null> {
  const hash = sha256(token);
  return withTenant(tenantId, async (db) => {
    const link = await db.one(
      `SELECT id, email FROM magic_links
        WHERE tenant_id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > now()`,
      [tenantId, hash]
    );
    if (!link) return null;
    await db.query("UPDATE magic_links SET used_at = now() WHERE id = $1 AND tenant_id = $2", [
      link.id,
      tenantId,
    ]);
    const session = randomBytes(32).toString("base64url");
    await db.query(
      `INSERT INTO portal_sessions (tenant_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, link.email, sha256(session), new Date(Date.now() + SESSION_TTL_MS).toISOString()]
    );
    return session;
  });
}

export interface PortalSession {
  email: string;
  tenantId: string;
}

/**
 * Read + validate the portal session for THIS tenant. A cookie minted on one
 * tenant's host can never authorize another tenant: the session row carries
 * tenant_id and the RLS context is the resolved tenant's.
 */
export async function getPortalSession(bundle: TenantBundle): Promise<PortalSession | null> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const hash = sha256(token);
  const row = await withTenant(bundle.tenant.id, (db) =>
    db.one(
      `SELECT email, tenant_id, token_hash FROM portal_sessions
        WHERE tenant_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [bundle.tenant.id, hash]
    )
  );
  if (!row || !safeEqual(row.token_hash, hash)) return null;
  return { email: row.email, tenantId: row.tenant_id };
}

export async function revokeSession(bundle: TenantBundle): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (!token) return;
  await withTenant(bundle.tenant.id, (db) =>
    db.query(
      "UPDATE portal_sessions SET revoked_at = now() WHERE tenant_id = $1 AND token_hash = $2",
      [bundle.tenant.id, sha256(token)]
    )
  );
}
