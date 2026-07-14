import { NextRequest, NextResponse } from "next/server";
import { getTenantBundle } from "@/lib/tenant";
import { redeemMagicLink, PORTAL_COOKIE } from "@/lib/portal-auth";

/** Magic-link landing: token → session cookie → /portal. */
export async function GET(req: NextRequest, ctx: RouteContext<"/s/[host]/portal/verify">) {
  const { host } = await ctx.params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return new Response("Not found", { status: 404 });

  const token = req.nextUrl.searchParams.get("token");
  // Rebuild the redirect from the ORIGINAL Host header — req.nextUrl carries
  // the server's own origin after the proxy rewrite, and redirecting there
  // would strand the owner on an unknown host.
  const realHost = req.headers.get("host") ?? decodeURIComponent(host);
  const proto = realHost.includes("localhost") || realHost.endsWith(".test") ? "http" : "https";
  const dest = new URL(`${proto}://${realHost}/portal`);

  if (!token) return NextResponse.redirect(dest);
  const session = await redeemMagicLink(bundle.tenant.id, token);
  if (!session) {
    dest.searchParams.set("link", "expired");
    return NextResponse.redirect(dest);
  }
  const res = NextResponse.redirect(dest);
  res.cookies.set(PORTAL_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !req.nextUrl.hostname.endsWith("localhost"),
    maxAge: 60 * 60 * 24,
    path: "/",
  });
  return res;
}
