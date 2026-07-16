/**
 * Request proxy (Next 16's middleware). One job: fold the Host header into
 * the route tree, so every page under src/app/s/[host]/ renders for exactly
 * one hostname. No database access here — resolution, status gating, and
 * 404s happen in the tenant layout, where they can be cached per tenant.
 *
 *   GET https://ironridgeoffroad.com/services
 *     → rewrite → /s/ironridgeoffroad.com/services
 *
 * Also handles the draft-preview handshake: ?preview=<token> becomes a
 * host-scoped cookie and redirects to the clean URL. The tenant layout
 * compares the cookie to tenants.preview_token.
 */
import { NextRequest, NextResponse } from "next/server";

const PREVIEW_COOKIE = "cs_preview";

export default function proxy(request: NextRequest) {
  const url = request.nextUrl;
  // Behind the Cloudflare edge Worker (Session 4), Host is the Container Apps
  // FQDN (that's how ACA ingress routes) and the visitor's real hostname rides
  // in X-Forwarded-Host. Only trusted when TRUST_PROXY_HOST=1 — locally an
  // attacker-supplied X-Forwarded-Host must stay meaningless.
  const forwardedHost =
    process.env.TRUST_PROXY_HOST === "1"
      ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || null
      : null;
  const host = forwardedHost ?? request.headers.get("host");

  // The image optimizer fetches /uploads/<slug>/<file> through an internal
  // mock request that carries NO Host header (Next 16, fetchInternalImage).
  // The path already names the tenant, so route it to that tenant's platform
  // host instead of failing tenant resolution. Local-dev path only — real
  // uploads move to Azure Blob remotePatterns in Session 4.
  if (url.pathname.startsWith("/uploads/")) {
    const slug = url.pathname.split("/")[2];
    if (slug) {
      const apex = process.env.PLATFORM_APEX ?? "localhost";
      const rewritten = url.clone();
      rewritten.pathname = `/s/${encodeURIComponent(`${slug.toLowerCase()}.${apex}`)}${url.pathname}`;
      return NextResponse.rewrite(rewritten);
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
