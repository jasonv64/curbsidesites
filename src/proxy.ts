/**
 * Request proxy (Next 16's middleware). Folds the Host header into the route
 * tree, so every page under src/app/s/[host]/ renders for exactly one
 * hostname — and runs the two gates that must fire BEFORE anything renders:
 * the D23 edge-secret check and the draft/unknown-host visibility gate (one
 * indexed DB read via tenant-gate.ts; the full bundle load and caching stay
 * in the tenant layout).
 *
 *   GET https://ironridgeoffroad.com/services
 *     → rewrite → /s/ironridgeoffroad.com/services
 *
 * Also handles the draft-preview handshake: ?preview=<token> becomes a
 * host-scoped cookie and redirects to the clean URL — and enforces it:
 * a draft tenant without the right cookie is 404'd HERE, before any
 * rendering starts. The layout's own gate is defense-in-depth only; Next
 * streams the page concurrently with the layout, so a layout-level
 * notFound() leaves draft content in the 404 body (found 2026-07-18 on the
 * dub-dates fixture, fixed in Session 1).
 */
import { timingSafeEqual, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hostBlocked } from "@/lib/tenant-gate";

const PREVIEW_COOKIE = "cs_preview";

/** Constant-time string compare (hash first so lengths always match). */
function secretMatches(candidate: string | null, secret: string): boolean {
  const a = createHash("sha256").update(candidate ?? "").digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export default async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  // Behind the Cloudflare edge Worker (Session 4), Host is the Container Apps
  // FQDN (that's how ACA ingress routes) and the visitor's real hostname rides
  // in X-Forwarded-Host. Only trusted when TRUST_PROXY_HOST=1 — locally an
  // attacker-supplied X-Forwarded-Host must stay meaningless.
  const trustProxy = process.env.TRUST_PROXY_HOST === "1";
  const forwardedHost = trustProxy
    ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || null
    : null;
  const host = forwardedHost ?? request.headers.get("host");

  // The image optimizer fetches /uploads/<slug>/<file> through an internal
  // mock request that carries NO Host header (Next 16, fetchInternalImage) —
  // and no edge secret either, so it is exempt from the D23 gate below. Safe:
  // the path names the tenant (no header decides tenancy) and everything
  // under it is public site imagery (ASSUMPTIONS #75). Local-dev path only —
  // real uploads move to Azure Blob remotePatterns in Session 4.
  if (url.pathname.startsWith("/uploads/")) {
    const slug = url.pathname.split("/")[2];
    if (slug) {
      const apex = process.env.PLATFORM_APEX ?? "localhost";
      const rewritten = url.clone();
      rewritten.pathname = `/s/${encodeURIComponent(`${slug.toLowerCase()}.${apex}`)}${url.pathname}`;
      return NextResponse.rewrite(rewritten);
    }
  }

  // The trust boundary (D23): the origin FQDN is public and X-Forwarded-Host
  // decides tenancy, so proxied mode only serves requests that PROVE they
  // came through our edge Worker — the shared secret it sets in
  // X-Curbside-Edge. Without this, every edge control (WAF, redirects,
  // failover, the draft gate's noindex surface) is optional to anyone who
  // curls the Container App directly with a forged X-Forwarded-Host.
  if (trustProxy) {
    const edgeSecret = process.env.EDGE_SHARED_SECRET;
    if (!edgeSecret) {
      // D23's invariant, structurally: TRUST_PROXY_HOST=1 must never run
      // behind an ingress that doesn't authenticate the edge. Loud per D11 —
      // fix by setting EDGE_SHARED_SECRET on the Container App and the
      // matching `wrangler secret put EDGE_SHARED_SECRET` on the Worker.
      throw new Error(
        "TRUST_PROXY_HOST=1 requires EDGE_SHARED_SECRET (D23). Set it on the app and the edge Worker — src/proxy.ts."
      );
    }
    if (!secretMatches(request.headers.get("x-curbside-edge"), edgeSecret)) {
      return new NextResponse("Forbidden: origin only serves edge traffic", { status: 403 });
    }
  }

  if (!host) return new NextResponse("Bad request: missing Host", { status: 400 });

  // Control-plane surfaces (Session 2). Two reserved hosts, never tenants
  // (the tenants table has a CHECK forbidding these slugs):
  //   admin.<apex>          → /admin/*     staff-only control plane (D16)
  //   <apex> / www.<apex>   → /platform/*  the public intake form (Part 2.1);
  //                            Session 5 grows this into curbsidesites.com
  const apex = (process.env.PLATFORM_APEX ?? "localhost").toLowerCase();
  const bareHost = host.toLowerCase().replace(/:\d+$/, "");
  if (bareHost === `admin.${apex}`) {
    const rewritten = url.clone();
    rewritten.pathname = `/admin${url.pathname === "/" ? "" : url.pathname}`;
    return NextResponse.rewrite(rewritten);
  }
  if (bareHost === apex || bareHost === `www.${apex}`) {
    const rewritten = url.clone();
    rewritten.pathname = `/platform${url.pathname === "/" ? "" : url.pathname}`;
    return NextResponse.rewrite(rewritten);
  }

  const preview = url.searchParams.get("preview");
  if (preview) {
    const clean = url.clone();
    clean.searchParams.delete("preview");
    // nextUrl carries the ACA-internal host when we're behind the edge Worker;
    // redirect the visitor to the hostname they actually asked for.
    if (forwardedHost) {
      clean.protocol = "https:";
      clean.host = forwardedHost;
      clean.port = "";
    }
    const res = NextResponse.redirect(clean);
    res.cookies.set(PREVIEW_COOKIE, preview, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });
    return res;
  }

  // Visibility gate (SPECS.md §I Part 2: draft content is preview-cookie-
  // only). Must run before the rewrite so no draft markup ever streams.
  // Unknown hosts take the same branch, so a gated draft is byte-identical
  // to a host that doesn't exist (drafts must not be enumerable).
  if (await hostBlocked(host, request.cookies.get(PREVIEW_COOKIE)?.value)) {
    // No route matches this path → the root not-found page, status 404.
    const blocked = url.clone();
    blocked.pathname = "/host-gate-404";
    return NextResponse.rewrite(blocked);
  }

  const rewritten = url.clone();
  rewritten.pathname = `/s/${encodeURIComponent(host.toLowerCase())}${url.pathname}`;
  return NextResponse.rewrite(rewritten);
}

export const config = {
  // Everything except: platform-level API routes (status, Stripe webhooks,
  // job runner, health probe), Next internals, and the favicon.
  // robots/sitemap/llms/feed are per-tenant and DO get rewritten — route
  // handlers under /s/[host].
  matcher: ["/((?!api/status|api/stripe|api/jobs|api/health|_next/|favicon\\.ico).*)"],
};
