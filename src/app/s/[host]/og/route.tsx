import { ImageResponse } from "next/og";
import { getTenantBundle } from "@/lib/tenant";
import { bestTextOn, resolveTokens } from "@/lib/brand";

export const runtime = "nodejs";

/**
 * Auto-generated OG images (Part 8) in the tenant's palette. ?title= for
 * posts; default card otherwise. System fonts — next/og can't reach the
 * pairing fonts at the edge, and OG cards don't need them.
 */
export async function GET(req: Request, ctx: RouteContext<"/s/[host]/og">) {
  const { host } = await ctx.params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return new Response("Not found", { status: 404 });
  const tokens = resolveTokens(bundle.brand?.tokens);
  const url = new URL(req.url);
  const title = url.searchParams.get("title")?.slice(0, 120) ?? bundle.tenant.business_name;
  const sub = url.searchParams.get("title")
    ? bundle.tenant.business_name
    : bundle.profile?.tagline ?? `${bundle.profile?.nap.city ?? ""}, ${bundle.profile?.nap.region ?? ""}`;
  const onDark = bestTextOn(tokens.brand_dark);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: 64,
          background: `linear-gradient(135deg, ${tokens.brand_dark} 0%, ${tokens.brand} 100%)`,
        }}
      >
        <div style={{ width: 120, height: 10, background: tokens.accent, marginBottom: 28 }} />
        <div
          style={{
            fontSize: title.length > 60 ? 52 : 68,
            fontWeight: 800,
            color: onDark,
            lineHeight: 1.05,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 30, color: onDark, opacity: 0.75, marginTop: 20 }}>{sub}</div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
