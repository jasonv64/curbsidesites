import { getTenantBundle, canonicalOrigin } from "@/lib/tenant";
import { llmsTxt } from "@/lib/seo";

/**
 * llms.txt — a readme for robots (Part 9). AI assistants increasingly answer
 * "who should I call" from exactly this. Generated from the record; the phone
 * number is the canonical NAP, never a DNI number (Invariant 6).
 */
export async function GET(_req: Request, ctx: RouteContext<"/s/[host]/llms.txt">) {
  const { host } = await ctx.params;
  const rawHost = decodeURIComponent(host);
  const bundle = await getTenantBundle(rawHost);
  if (!bundle || bundle.tenant.status !== "live") {
    return new Response("Not found", { status: 404 });
  }
  const origin = canonicalOrigin(bundle, bundle.hostKind, rawHost);
  return new Response(llmsTxt(bundle, origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
