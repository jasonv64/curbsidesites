/**
 * The content pipeline (Part 6): the recurring labor Curb+ and Curb Pro are
 * actually buying — 2 or 4 posts a month (D19), each answering one long-tail
 * local query, internal-linked to a service section and the contact page
 * (the step everyone skips; here it's code, not discipline).
 *
 * Voice comes through getVoiceSource — the consent gate from Session 2. An
 * unconsented transcript is a hard refusal there, and this pipeline treats
 * that refusal as an alert, never a workaround.
 *
 * HUMAN REVIEW BEFORE PUBLISH, ALWAYS. These are trades: a confidently wrong
 * torque spec published under a real business's name is a safety problem, not
 * an SEO problem. Drafts land with published_at NULL plus a queue item; only
 * a person flips them live (publishPost). Not a bottleneck to optimize away.
 */
import { audit, controlOne, controlQuery } from "@/lib/control/db";
import { getVoiceSource, type VoiceSource } from "@/lib/control/content-seeding";
import { slugify } from "@/lib/control/onboarding";
import { frontmatterSchema } from "@/lib/schemas";
import { secretProvider } from "@/lib/secrets";
import type { RunStatus } from "./scheduler";

export const POSTS_PER_MONTH: Record<string, number> = {
  curb: 0,
  curb_plus: 2,
  curb_pro: 4,
};

interface DraftPost {
  title: string;
  description: string;
  target_query: string;
  body: string;
  tags: string[];
}

export async function runContentCalendar(tenant: {
  tenant_id: string;
  slug: string;
  business_name: string;
  plan_tier: string;
  features: Record<string, boolean>;
}): Promise<{ status: RunStatus; detail: Record<string, unknown> }> {
  const quota = POSTS_PER_MONTH[tenant.plan_tier] ?? 0;
  const extra = Number(tenant.features?.extra_posts ?? 0) || 0; // à-la-carte, D19
  const target = quota + extra;
  if (target === 0) return { status: "skipped", detail: { reason: `plan '${tenant.plan_tier}' has no monthly posts` } };

  // What already counts toward this calendar month: published this month, or
  // pipeline drafts created this month still awaiting review.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const existing = await controlOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM content
      WHERE tenant_id = $1 AND type = 'post'
        AND (published_at >= $2 OR (published_at IS NULL AND created_at >= $2))`,
    [tenant.tenant_id, monthStart]
  );
  const needed = target - (existing?.n ?? 0);
  if (needed <= 0) {
    return { status: "ok", detail: { reason: "month's quota already drafted/published", target, existing: existing?.n } };
  }

  const voice = await getVoiceSource(tenant.tenant_id); // ConsentError → runner alert
  const profile = await controlOne<{ nap: { city?: string; region?: string }; service_area: string[] }>(
    "SELECT nap, service_area FROM business_profile WHERE tenant_id = $1",
    [tenant.tenant_id]
  );
  const services = await controlQuery<{ slug: string; name: string; blurb: string }>(
    "SELECT slug, name, blurb FROM services WHERE tenant_id = $1 ORDER BY sort_order",
    [tenant.tenant_id]
  );
  if (services.length === 0) return { status: "skipped", detail: { reason: "no services to write about yet" } };
  const usedQueries = await controlQuery<{ q: string }>(
    `SELECT DISTINCT frontmatter->>'target_query' AS q FROM content
      WHERE tenant_id = $1 AND frontmatter->>'target_query' IS NOT NULL`,
    [tenant.tenant_id]
  );

  const ctx = {
    business_name: tenant.business_name,
    city: profile?.nap?.city ?? "",
    region: profile?.nap?.region ?? "CA",
    service_area: profile?.service_area ?? [],
    services,
    avoid: usedQueries.map((r) => r.q).filter(Boolean),
  };

  let drafts: DraftPost[];
  let generator = "deterministic";
  const key = await secretProvider().get("curbside-anthropic-api-key");
  if (key) {
    drafts = await draftWithClaude(ctx, voice, needed, key);
    generator = "anthropic";
  } else {
    drafts = draftDeterministic(ctx, needed);
  }

  const today = new Date().toISOString().slice(0, 10);
  const slugs: string[] = [];
  for (const draft of drafts.slice(0, needed)) {
    const slug = slugify(draft.title).slice(0, 60) || `post-${today}-${slugs.length + 1}`;
    const body = ensureInternalLinks(draft.body, draft, services);
    const frontmatter = {
      ...frontmatterSchema.parse({
        title: draft.title,
        description: draft.description,
        date: today,
        author: tenant.business_name,
        tags: draft.tags,
      }),
      target_query: draft.target_query,
    };
    await controlQuery(
      `INSERT INTO content (tenant_id, type, slug, frontmatter, body, published_at)
       VALUES ($1, 'post', $2, $3, $4, NULL)
       ON CONFLICT (tenant_id, type, slug) DO NOTHING`,
      [tenant.tenant_id, slug, JSON.stringify(frontmatter), body]
    );
    slugs.push(slug);
  }

  // The human gate: a queue item a person must work. Publishing happens in
  // the admin/portal after READING the drafts, per post.
  await controlQuery(
    `INSERT INTO pending_actions (tenant_id, kind, reason, payload)
     VALUES ($1, 'review_content', $2, $3)`,
    [
      tenant.tenant_id,
      `${slugs.length} draft post(s) for ${tenant.slug} await human review — read them before publishing (trades content: wrong specs are a safety problem)`,
      JSON.stringify({ slugs, generator, voice: voice.kind }),
    ]
  );
  await audit("growth-pipeline", tenant.tenant_id, "content.monthly_drafted", { slugs, generator, voice: voice.kind });
  return { status: "ok", detail: { drafted: slugs.length, generator, voice: voice.kind } };
}

/**
 * Internal-link every post (Part 6): if the body doesn't already link a
 * service section and the contact page, a closing paragraph adds both —
 * matched to the most relevant service by title/tag overlap.
 */
export function ensureInternalLinks(
  body: string,
  draft: Pick<DraftPost, "title" | "tags">,
  services: { slug: string; name: string }[]
): string {
  const hasServiceLink = /\]\(\/services/.test(body);
  const hasContactLink = /\]\(\/contact/.test(body);
  if (hasServiceLink && hasContactLink) return body;

  const haystack = `${draft.title} ${draft.tags.join(" ")}`.toLowerCase();
  const match =
    services.find((s) => s.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && haystack.includes(w))) ??
    services[0];

  const additions: string[] = [];
  if (!hasServiceLink) additions.push(`[${match.name}](/services#${match.slug})`);
  if (!hasContactLink) additions.push(`[get a straight answer on your job](/contact)`);
  return `${body.trimEnd()}\n\n---\n\n*More on this from us: ${additions.join(" · ")}.*\n`;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

interface DraftContext {
  business_name: string;
  city: string;
  region: string;
  service_area: string[];
  services: { slug: string; name: string; blurb: string }[];
  avoid: string[];
}

async function draftWithClaude(
  ctx: DraftContext,
  voice: VoiceSource,
  count: number,
  apiKey: string
): Promise<DraftPost[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      tools: [
        {
          name: "deliver_posts",
          description: "Deliver the drafted blog posts",
          input_schema: {
            type: "object",
            properties: {
              posts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    target_query: { type: "string" },
                    body: { type: "string", description: "Markdown with ## headings, 500-900 words" },
                    tags: { type: "array", items: { type: "string" } },
                  },
                  required: ["title", "description", "target_query", "body", "tags"],
                },
              },
            },
            required: ["posts"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "deliver_posts" },
      messages: [
        {
          role: "user",
          content: [
            `Draft ${count} blog post(s) for a local service business, in the OWNER'S OWN VOICE (sample below).`,
            `Each post answers exactly ONE long-tail local search query (put it in target_query) with a genuinely`,
            `useful answer — the kind featured snippets and LLMs quote. "Leveling kit vs lift kit" beats "5 tips".`,
            `NEVER invent maintenance intervals, torque specs, prices, or safety claims — these are trades and a`,
            `confidently wrong number under a real business's name is dangerous. Where a spec matters, say`,
            `"check your manual / ask us" instead of guessing. Never invent statistics or review counts (Invariant 12).`,
            "",
            `Business: ${ctx.business_name}, ${ctx.city}, ${ctx.region}. Service area: ${ctx.service_area.join(", ")}.`,
            `Services: ${ctx.services.map((s) => `${s.name} — ${s.blurb}`).join("; ")}`,
            ctx.avoid.length ? `Queries already covered (do NOT repeat): ${ctx.avoid.join("; ")}` : "",
            "",
            `Voice sample (${voice.kind === "transcript" ? "consented call transcript" : "their own written words"}):`,
            voice.text.slice(0, 6000),
          ].join("\n"),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const toolUse = body.content?.find((c: { type: string }) => c.type === "tool_use");
  if (!toolUse?.input?.posts) throw new Error("Anthropic response had no posts");
  return toolUse.input.posts as DraftPost[];
}

/** Offline fallback: honest scaffolds a human EDITOR fills before publish. */
function draftDeterministic(ctx: DraftContext, count: number): DraftPost[] {
  const covered = new Set(ctx.avoid);
  const drafts: DraftPost[] = [];
  for (const s of ctx.services) {
    if (drafts.length >= count) break;
    const query = `how often should i service my ${s.name.toLowerCase()} ${ctx.city.toLowerCase()}`;
    if (covered.has(query)) continue;
    drafts.push({
      title: `How often does ${s.name.toLowerCase()} really need doing?`,
      description: `A working answer from ${ctx.business_name} in ${ctx.city}: what drives the interval, the signs you're overdue, and when to just call.`,
      target_query: query,
      body: [
        `"How often?" is the question we hear most about ${s.name.toLowerCase()}, and the honest answer depends on how you use it. Here's how we'd think it through if you were standing in the shop.`,
        "",
        `## What actually drives the interval`,
        "",
        `${s.blurb || `${s.name} wear depends on load, conditions, and how it was set up.`} Your usage matters more than the calendar.`,
        "",
        `## Signs you're overdue`,
        "",
        `- Something feels, sounds, or smells different than it did last season`,
        `- You can't remember the last time it was looked at`,
        `- You're about to rely on it for a big trip or a busy stretch`,
        "",
        `## The straight answer`,
        "",
        `For the exact interval on YOUR setup, check the manufacturer's schedule or ask us — we'd rather quote the real number for your equipment than print a guess here. We serve ${ctx.service_area.join(", ") || ctx.city}.`,
        "",
        `*Draft generated by the Curbside content pipeline — a human editor reviews, corrects, and approves every post before it publishes.*`,
      ].join("\n"),
      tags: [slugify(s.name), "maintenance"],
    });
    covered.add(query);
  }
  return drafts;
}
