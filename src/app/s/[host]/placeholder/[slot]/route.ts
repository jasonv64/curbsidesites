import { getTenantBundle } from "@/lib/tenant";
import { resolveTokens } from "@/lib/brand";
import { placeholderSvg } from "@/lib/placeholder";

/**
 * Branded SVG placeholder for an image slot (Part 10). Aspect comes from the
 * slot's images row when one exists; palette is the tenant's own tokens.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/s/[host]/placeholder/[slot]">
) {
  const { host, slot } = await ctx.params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return new Response("Not found", { status: 404 });
  const slotId = decodeURIComponent(slot);
  const row = bundle.images.find((i) => i.slot_id === slotId);
  const tokens = resolveTokens(bundle.brand?.tokens);
  const svg = placeholderSvg(slotId, row?.aspect ?? defaultAspect(slotId), tokens);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

function defaultAspect(slot: string): string {
  if (slot.startsWith("gallery")) return "1:1";
  if (slot.startsWith("instagram")) return "1:1";
  if (slot === "hero") return "16:9";
  return "4:3";
}
