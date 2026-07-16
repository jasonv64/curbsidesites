/**
 * Health probe for Container Apps (readiness/liveness) and the Cloudflare
 * edge Worker. Excluded from the host-routing proxy, so it answers on any
 * hostname — including the bare ACA FQDN a probe uses.
 *
 * Deliberately checks the database: a replica that can't reach Postgres
 * can't serve a single tenant page, and 503ing here is what lets the edge
 * fail over to static snapshots (D6) instead of serving errors.
 *
 * Unauthenticated by design; returns nothing but a boolean (Invariant 3).
 */
import { platformQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await Promise.race([
      platformQuery("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), 3000)),
    ]);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
