/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30s step) on node:crypto — no dependency.
 * Verified against authenticator apps via the otpauth:// provisioning URI.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160-bit, per RFC 4226 recommendation
}

function hotp(secretB32: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

/** Accepts the current step ±1 (clock skew tolerance). */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): boolean {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const step = Math.floor(now / 1000 / 30);
  for (const c of [step - 1, step, step + 1]) {
    const expected = hotp(secretB32, c);
    if (
      expected.length === normalized.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))
    ) {
      return true;
    }
  }
  return false;
}

export function otpauthUri(email: string, secretB32: string): string {
  const issuer = encodeURIComponent("Curbside Sites");
  return `otpauth://totp/${issuer}:${encodeURIComponent(email)}?secret=${secretB32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}
