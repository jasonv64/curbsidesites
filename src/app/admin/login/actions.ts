"use server";

/**
 * Staff login (D16): password stage → TOTP stage (or first-login enrollment).
 * The cookie is host-scoped to admin.<apex>; the session row starts mfa_ok =
 * false and nothing staff-guarded works until TOTP passes.
 */
import { cookies } from "next/headers";
import {
  STAFF_COOKIE,
  completeMfa,
  decryptSecret,
  encryptSecret,
  getStaffSession,
  revokeStaffSession,
  startStaffSession,
} from "@/lib/control/staff-auth";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/control/totp";
import { audit, controlOne, controlQuery } from "@/lib/control/db";
import { rateLimit, rateLimitPeek } from "@/lib/rate-limit";

// step "done" → the client hard-navigates (window.location) instead of a
// server-action redirect(): the action-inlined redirect payload renders
// without the browser's Host header, so on a host-routed app it streams the
// WRONG surface (platform home instead of /admin). Gotcha documented in the
// README; a full navigation re-runs the proxy with the real Host.
export interface LoginState {
  step: "password" | "mfa" | "enroll" | "done";
  error?: string;
  otpauth?: string;
  secret?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  // Only FAILED attempts count against the window — an operator who signs in
  // successfully several times a day is not an attack.
  const rlKey = `staff-login:${email}`;
  if (!rateLimitPeek(rlKey, 5, 10 * 60_000)) {
    return { step: "password", error: "Too many attempts — wait a few minutes." };
  }

  const started = await startStaffSession(email, password);
  if (!started) {
    rateLimit(rlKey, 5, 10 * 60_000);
    return { step: "password", error: "Wrong email or password." };
  }

  const jar = await cookies();
  jar.set(STAFF_COOKIE, started.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });

  if (started.user.totp_enabled) return { step: "mfa" };

  // First login: enroll MFA before anything else works (D16: real auth WITH MFA).
  const secret = generateTotpSecret();
  await controlQuery("UPDATE staff_users SET totp_secret_enc = $2 WHERE id = $1", [
    started.user.id,
    encryptSecret(secret),
  ]);
  return { step: "enroll", otpauth: otpauthUri(started.user.email, secret), secret };
}

async function verifyCodeForSession(code: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getStaffSession();
  if (!session) return { ok: false, error: "Session expired — start over." };
  const row = await controlOne<{ totp_secret_enc: string | null }>(
    "SELECT totp_secret_enc FROM staff_users WHERE id = $1",
    [session.id]
  );
  if (!row?.totp_secret_enc) return { ok: false, error: "No authenticator is set up — start over." };
  if (!verifyTotp(decryptSecret(row.totp_secret_enc), code)) {
    return { ok: false, error: "That code didn't match. Codes rotate every 30 seconds — try the current one." };
  }
  return { ok: true };
}

export async function mfaAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const code = String(formData.get("code") ?? "");
  const result = await verifyCodeForSession(code);
  if (!result.ok) return { step: "mfa", error: result.error };

  const jar = await cookies();
  await completeMfa(jar.get(STAFF_COOKIE)!.value);
  const session = await getStaffSession();
  await controlQuery("UPDATE staff_users SET last_login_at = now() WHERE id = $1", [session!.id]);
  await audit(session!.email, null, "staff.login", {});
  return { step: "done" };
}

export async function enrollAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  const code = String(formData.get("code") ?? "");
  const result = await verifyCodeForSession(code);
  if (!result.ok) return { ...prev, step: "enroll", error: result.error };

  const session = await getStaffSession();
  await controlQuery("UPDATE staff_users SET totp_enabled = true, last_login_at = now() WHERE id = $1", [
    session!.id,
  ]);
  const jar = await cookies();
  await completeMfa(jar.get(STAFF_COOKIE)!.value);
  await audit(session!.email, null, "staff.mfa_enrolled", {});
  return { step: "done" };
}

/** Client hard-navigates to /login afterwards (see LoginState note). */
export async function logoutAction(): Promise<void> {
  await revokeStaffSession();
  const jar = await cookies();
  jar.delete(STAFF_COOKIE);
}
