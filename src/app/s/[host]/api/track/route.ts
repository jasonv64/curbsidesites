import { z } from "zod";
import { getTenantBundle } from "@/lib/tenant";
import { attributeSource, CONVERSION_TYPES, trackEvent, type ConversionType } from "@/lib/events";
import { rateLimit } from "@/lib/rate-limit";

const beaconSchema = z.object({
  type: z.enum(CONVERSION_TYPES),
  payload: z
    .object({
      path: z.string().max(300).optional(),
      referrer: z.string().max(500).nullable().optional(),
      utm_source: z.string().max(100).nullable().optional(),
      slot: z.string().max(100).optional(),
    })
    .default({}),
});

/** Conversion beacon endpoint (D14). Client components sendBeacon here. */
export async function POST(req: Request, ctx: RouteContext<"/s/[host]/api/track">) {
  const { host } = await ctx.params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return new Response(null, { status: 404 });

  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!rateLimit(`track:${bundle.tenant.id}:${ip}`, 60, 60_000)) {
    return new Response(null, { status: 429 });
  }

  let parsed;
  try {
    parsed = beaconSchema.safeParse(await req.json());
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!parsed.success) return new Response(null, { status: 400 });

  const { type, payload } = parsed.data;
  await trackEvent(bundle.tenant.id, type as ConversionType, {
    ...payload,
    source: attributeSource(payload.referrer ?? null, payload.utm_source ?? null),
  });
  return new Response(null, { status: 204 });
}
