/**
 * Content seeding (Part 2.6): AI drafts site copy and 2–3 blog posts in the
 * owner's voice, each targeting one long-tail local query. HUMAN REVIEW
 * BEFORE PUBLISH, ALWAYS — drafts land with published_at NULL and only a
 * person can flip them.
 *
 * CONSENT (2.2.4): the voice source of preference is the onboarding-call
 * transcript, and this pipeline REFUSES to run against a transcript whose
 * consent chain is incomplete — written consent (intake or staff-recorded,
 * not withdrawn) AND verbal consent captured in the recording. No transcript
 * is an inconvenience (we fall back to the intake voice field); an
 * unconsented transcript is a hard stop, not a warning.
 */
import { z } from "zod";
import { audit, controlOne, controlQuery, revalidateTenant } from "@/lib/control/db";
import { secretProvider } from "@/lib/secrets";
import { frontmatterSchema } from "@/lib/schemas";
import { slugify } from "@/lib/control/onboarding";

export class ConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsentError";
  }
}

export interface VoiceSource {
  kind: "transcript" | "intake_voice_field";
  text: string;
}

/**
 * Resolve the voice source under the 2.2 consent regime. Exported so the
 * verification suite can prove the refusal (Part 12.4).
 */
export async function getVoiceSource(tenantId: string): Promise<VoiceSource> {
  const transcript = await controlOne<{ id: string; body: string; verbal_consent: boolean }>(
    "SELECT id, body, verbal_consent FROM transcripts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
    [tenantId]
  );

  if (transcript) {
    const written = await controlOne(
      `SELECT 1 FROM consents
        WHERE tenant_id = $1 AND kind = 'call_recording_ai' AND withdrawn_at IS NULL`,
      [tenantId]
    );
    if (!written) {
      throw new ConsentError(
        "A transcript exists but there is NO active written recording consent for this tenant. " +
          "Refusing to process it (CONTROL-PLANE 2.2.4 / Cal. Penal Code §632). " +
          "Either record the consent that was actually given (admin → tenant → consent), or delete the transcript."
      );
    }
    if (!transcript.verbal_consent) {
      throw new ConsentError(
        "A transcript exists but verbal consent was not confirmed in the recording (2.2.2). " +
          "Refusing to process it. If verbal consent WAS captured, mark it on the transcript; " +
          "otherwise delete the transcript and use the intake voice field."
      );
    }
    return { kind: "transcript", text: transcript.body };
  }

  const profile = await controlOne<{ voice_notes: string | null; about: string | null }>(
    "SELECT voice_notes, about FROM business_profile WHERE tenant_id = $1",
    [tenantId]
  );
  const text = profile?.voice_notes || profile?.about;
  if (!text) {
    throw new Error(
      "No voice source at all: no transcript and no intake voice field. Seed business_profile.voice_notes first."
    );
  }
  return { kind: "intake_voice_field", text };
}

// ---------------------------------------------------------------------------
// Draft generation
// ---------------------------------------------------------------------------

const generatedSchema = z.object({
  tagline: z.string().min(5).max(120),
  about: z.string().min(100).max(2500),
  posts: z
    .array(
      z.object({
        title: z.string().min(10).max(120),
        description: z.string().min(20).max(300),
        target_query: z.string().min(5).max(120),
        body: z.string().min(400),
        tags: z.array(z.string()).max(5),
      })
    )
    .min(2)
    .max(3),
});
type Generated = z.infer<typeof generatedSchema>;

interface TenantContext {
  business_name: string;
  city: string;
  region: string;
  service_area: string[];
  services: { name: string; blurb: string }[];
}

async function generateWithClaude(ctx: TenantContext, voice: VoiceSource, apiKey: string): Promise<Generated> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      // Adaptive thinking is OFF unless asked for explicitly on this model.
      // These drafts are read by a human before publishing (GROWTH Part 6), so
      // the reasoning is worth paying for — and without it the model tends to
      // leak its working into the visible copy.
      thinking: { type: "adaptive" },
      tools: [
        {
          name: "deliver_content",
          description: "Deliver the drafted site copy and blog posts",
          input_schema: {
            type: "object",
            properties: {
              tagline: { type: "string" },
              about: { type: "string" },
              posts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    target_query: { type: "string" },
                    body: { type: "string", description: "Markdown, 500-900 words" },
                    tags: { type: "array", items: { type: "string" } },
                  },
                  required: ["title", "description", "target_query", "body", "tags"],
                },
              },
            },
            required: ["tagline", "about", "posts"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "deliver_content" },
      messages: [
        {
          role: "user",
          content: [
            `Draft website copy for a local service business. Write in the OWNER'S OWN VOICE — match the rhythm, vocabulary, and attitude of the voice sample below. Plain, concrete, zero marketing fluff. Never invent statistics, years in business, certifications, or review counts (Invariant 12: never inflate a client-facing number).`,
            "",
            `Business: ${ctx.business_name}, ${ctx.city}, ${ctx.region}`,
            `Service area: ${ctx.service_area.join(", ")}`,
            `Services: ${ctx.services.map((s) => `${s.name} — ${s.blurb}`).join("; ")}`,
            "",
            `Voice sample (${voice.kind === "transcript" ? "onboarding call transcript, consented" : "their own written words"}):`,
            voice.text.slice(0, 6000),
            "",
            `Deliver: a tagline (short, concrete, theirs); an about section (2-3 paragraphs); and 2-3 blog posts, EACH targeting exactly one long-tail local search query a real customer in ${ctx.city} would type (put the query in target_query). Posts are markdown with ## headings, 500-900 words, genuinely useful, priced honestly where prices are implied by the service blurbs only.`,
          ].join("\n"),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const toolUse = body.content?.find((c: { type: string }) => c.type === "tool_use");
  if (!toolUse) throw new Error("Anthropic response had no tool_use block");
  return generatedSchema.parse(toolUse.input);
}

/** No API key → serviceable deterministic drafts. The pipeline must work offline. */
function generateDeterministic(ctx: TenantContext, voice: VoiceSource): Generated {
  const firstSentence = voice.text.split(/(?<=[.!?])\s/)[0]?.slice(0, 110) ?? `${ctx.business_name} — ${ctx.city}`;
  const posts = ctx.services.slice(0, 2).map((s) => ({
    title: `What does ${s.name.toLowerCase()} cost in ${ctx.city}?`,
    description: `A straight answer on ${s.name.toLowerCase()} for ${ctx.city} and ${ctx.service_area[0] ?? "nearby"}: what drives the price, what to ask, and when it's worth it.`,
    target_query: `${s.name.toLowerCase()} cost ${ctx.city.toLowerCase()}`,
    body: [
      `Every week someone calls asking what ${s.name.toLowerCase()} runs. The honest answer is "it depends" — but here's what it depends ON, so you can budget before you call anyone.`,
      "",
      `## What drives the price`,
      "",
      `${s.blurb || `${s.name} varies with the scope of the job.`} The biggest factors are the condition of what we're starting with, access to the work area, and materials.`,
      "",
      `## What to ask any shop (including us)`,
      "",
      `- Is the quote itemized, or one number?`,
      `- What happens if you find something worse once you're in?`,
      `- Is the work warrantied, and for how long?`,
      "",
      `## The straight answer`,
      "",
      `Call us with the details and we'll give you a real number, not a teaser rate. We serve ${ctx.service_area.join(", ")} — and if the job isn't worth doing, we'll tell you that too.`,
      "",
      `*This draft was generated from your intake details — your Curbside editor reviews and rewrites it with you before anything publishes.*`,
    ].join("\n"),
    tags: [slugify(s.name), "pricing"],
  }));
  return {
    tagline: firstSentence,
    about: voice.text.slice(0, 2000),
    posts,
  };
}

// ---------------------------------------------------------------------------

export interface SeedContentResult {
  voice: VoiceSource["kind"];
  generator: "anthropic" | "deterministic";
  post_slugs: string[];
}

/**
 * Run content seeding for one tenant. Posts land UNPUBLISHED (published_at
 * NULL — the portal/admin hides them from the public site until a human
 * publishes). Site copy (tagline/about) is applied only while the tenant is
 * still draft, where the brand gate + go-live review covers it.
 */
export async function seedContent(tenantId: string, actor: string): Promise<SeedContentResult> {
  const voice = await getVoiceSource(tenantId); // throws ConsentError on unconsented transcript

  const tenant = await controlOne<{ slug: string; status: string; business_name: string }>(
    "SELECT slug, status, business_name FROM tenants WHERE id = $1",
    [tenantId]
  );
  if (!tenant) throw new Error("seedContent: unknown tenant");
  const profile = await controlOne<{ nap: { city: string; region: string }; service_area: string[] }>(
    "SELECT nap, service_area FROM business_profile WHERE tenant_id = $1",
    [tenantId]
  );
  const services = await controlQuery<{ name: string; blurb: string }>(
    "SELECT name, blurb FROM services WHERE tenant_id = $1 ORDER BY sort_order",
    [tenantId]
  );
  const ctx: TenantContext = {
    business_name: tenant.business_name,
    city: profile?.nap?.city ?? "",
    region: profile?.nap?.region ?? "CA",
    service_area: profile?.service_area ?? [],
    services,
  };

  let generated: Generated;
  let generator: SeedContentResult["generator"] = "deterministic";
  const key = await secretProvider().get("curbside-anthropic-api-key");
  if (key) {
    generated = await generateWithClaude(ctx, voice, key);
    generator = "anthropic";
  } else {
    generated = generateDeterministic(ctx, voice);
  }

  const today = new Date().toISOString().slice(0, 10);
  const postSlugs: string[] = [];
  for (const post of generated.posts) {
    const slug = slugify(post.title).slice(0, 60) || `draft-${postSlugs.length + 1}`;
    const frontmatter = frontmatterSchema.parse({
      title: post.title,
      description: post.description,
      date: today,
      author: tenant.business_name,
      tags: post.tags,
    });
    await controlQuery(
      `INSERT INTO content (tenant_id, type, slug, frontmatter, body, published_at)
       VALUES ($1, 'post', $2, $3, $4, NULL)
       ON CONFLICT (tenant_id, type, slug)
       DO UPDATE SET frontmatter = $3, body = $4, updated_at = now()
       -- never touch published_at on conflict: a published post stays published
       `,
      [tenantId, slug, JSON.stringify(frontmatter), post.body]
    );
    postSlugs.push(slug);
  }

  if (tenant.status === "draft") {
    await controlQuery(
      "UPDATE business_profile SET tagline = $2, about = $3, updated_at = now() WHERE tenant_id = $1",
      [tenantId, generated.tagline, generated.about]
    );
  }

  await revalidateTenant(tenant.slug);
  await audit(actor, tenantId, "content.seeded", {
    voice: voice.kind,
    generator,
    posts: postSlugs,
  });
  return { voice: voice.kind, generator, post_slugs: postSlugs };
}

/** The human gate flipping a draft public (2.6 / GROWTH Part 6). */
export async function publishPost(tenantId: string, contentId: string, actor: string): Promise<void> {
  const row = await controlOne<{ slug: string; tslug: string }>(
    `SELECT c.slug, t.slug AS tslug FROM content c JOIN tenants t ON t.id = c.tenant_id
      WHERE c.id = $1 AND c.tenant_id = $2`,
    [contentId, tenantId]
  );
  if (!row) throw new Error("publishPost: no such draft on this tenant");
  await controlQuery("UPDATE content SET published_at = now(), updated_at = now() WHERE id = $1", [contentId]);
  await revalidateTenant(row.tslug);
  await audit(actor, tenantId, "content.published", { slug: row.slug });
}
