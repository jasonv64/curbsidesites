/**
 * Live parser: Anthropic API (D3), plain fetch, tool-use forced to a single
 * tool whose input schema mirrors changeDiffSchema — the model can only emit
 * a typed diff or an escalation. The output is still Zod-validated before
 * anything renders, and the CLIENT still confirms before anything applies.
 */
import { changeDiffSchema, type Hours } from "@/lib/schemas";
import type { ChangeParser, ParsedChange } from "./types";

export function liveChangeParser(apiKey: string, currentHours: Hours): ChangeParser {
  return {
    async parse(message: string): Promise<ParsedChange> {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 1024,
          system:
            "You translate a small-business owner's website change request into exactly one typed diff. " +
            "Their current weekly hours (24h): " + JSON.stringify(currentHours) + ". " +
            "hours_update must contain the FULL week (start from current hours, change only what they asked). " +
            "If the request is ambiguous, out of scope, or touches anything other than hours, services, or the tagline, emit kind=escalate. " +
            "confirmation must restate the change in one plain sentence a shop owner can answer yes/no to.",
          tools: [
            {
              name: "emit_change",
              description: "Emit the single typed change diff plus a plain-language confirmation question.",
              input_schema: {
                type: "object",
                properties: {
                  diff: { type: "object" },
                  confirmation: { type: "string" },
                },
                required: ["diff", "confirmation"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "emit_change" },
          messages: [{ role: "user", content: message }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as {
        content: { type: string; input?: { diff?: unknown; confirmation?: string } }[];
      };
      const tool = data.content.find((c) => c.type === "tool_use");
      const parsed = changeDiffSchema.safeParse(tool?.input?.diff);
      if (!parsed.success) {
        return {
          diff: { kind: "escalate", reason: "model output failed typed-diff validation" },
          confirmation:
            "I couldn't safely turn that into an automatic change — sending it to the Curbside team.",
          isDemo: false,
        };
      }
      return {
        diff: parsed.data,
        confirmation: tool?.input?.confirmation ?? "Confirm this change?",
        isDemo: false,
      };
    },
  };
}
