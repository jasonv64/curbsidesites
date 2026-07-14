import { z } from "zod";
import { getTenantBundle } from "@/lib/tenant";
import { getQuoteAssistant } from "@/lib/adapters/quote-assistant";
import { rateLimit } from "@/lib/rate-limit";

const askSchema = z.object({ message: z.string().min(2).max(1000) });

/** Chat endpoint for the quote-assistant widget (stub adapter behind it). */
export async function POST(
  req: Request,
  ctx: RouteContext<"/s/[host]/api/quote-assistant">
) {
  const { host } = await ctx.params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return Response.json({ error: "not found" }, { status: 404 });
  if (!bundle.tenant.features?.quote_assistant) {
    return Response.json({ error: "not enabled" }, { status: 404 });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!rateLimit(`qa:${bundle.tenant.id}:${ip}`, 20, 10 * 60_000)) {
    return Response.json(
      { reply: "Easy there — give it a minute, or just call the shop." },
      { status: 429 }
    );
  }

  let parsed;
  try {
    parsed = askSchema.safeParse(await req.json());
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });

  const assistant = await getQuoteAssistant(bundle);
  const answer = await assistant.ask(parsed.data.message);
  return Response.json({ reply: answer.reply, demo: answer.isDemo });
}
