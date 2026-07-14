/**
 * Image sourcing core (TENANT-APP Part 10). Shared by the CLI
 * (scripts/source-images.ts) and the seed script's demo bootstrap.
 *
 * Providers (the seam ASSUMPTIONS #28 promised):
 *   - Pexels     — preferred when PEXELS_API_KEY is set. Pexels license,
 *                  commercial use, no attribution required (credited anyway).
 *   - Openverse  — keyless fallback (api.openverse.org, anonymous: 20 req/min,
 *                  200/day). CC-licensed photos filtered to commercial-use
 *                  licenses. CC BY / BY-SA require attribution, which the
 *                  gallery page renders from images.credit.
 *
 * Candidates are cached in .data/image-candidates/<slug>/<slot>/ and reused on
 * re-runs (reseeding stays fast and works offline); pass refresh to re-search.
 */
import { Client } from "pg";
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const CANDIDATES_PER_SLOT = 4;
export const candidatesDir = (slug: string) =>
  join(process.cwd(), ".data", "image-candidates", slug);
export const uploadsDir = (slug: string) =>
  join(process.cwd(), process.env.UPLOAD_DIR ?? ".data/uploads", slug);

export interface Slot {
  slot_id: string;
  purpose: string;
  search_query: string;
  aspect: string;
  alt: string;
  url: string | null;
}

export interface Candidate {
  n: number;
  file: string;
  credit: string;
  sourceUrl: string;
}

export interface SlotResult {
  slot: Slot;
  query: string;
  provider: string;
  candidates: Candidate[];
}

interface Business {
  name: string;
  tagline: string;
  about: string;
  city: string;
  region: string;
  services: string[];
}

async function ownerDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

// ---------------------------------------------------------------------------
// Narrative-fit queries via Claude (optional, --ai)
// ---------------------------------------------------------------------------

export async function aiTuneQueries(
  slots: Slot[],
  business: Business
): Promise<Record<string, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("--ai needs ANTHROPIC_API_KEY in the environment (ops-side; never the app).");
  }

  const schema = {
    type: "object",
    properties: {
      queries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slot_id: { type: "string" },
            query: { type: "string" },
          },
          required: ["slot_id", "query"],
          additionalProperties: false,
        },
      },
    },
    required: ["queries"],
    additionalProperties: false,
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: [
            "You are art-directing stock photo searches for a local service business's website.",
            "Write one stock-photo search query per image slot. The photos must fit THIS business's",
            "narrative — its region and landscape, the vehicles/vessels its customers actually own,",
            "its trade — not generic stock-photo vibes. Keep queries 3-7 words, concrete and visual",
            "(subject + setting + light/mood). Avoid: people's readable faces as the subject,",
            "anything with visible business names, and subjects from the wrong trade.",
            "",
            `Business: ${business.name} — ${business.tagline}`,
            `Location: ${business.city}, ${business.region}`,
            `Services: ${business.services.join(", ")}`,
            `About: ${business.about}`,
            "",
            "Slots (slot_id | purpose | aspect | current query):",
            ...slots.map((s) => `- ${s.slot_id} | ${s.purpose} | ${s.aspect} | ${s.search_query || "(none)"}`),
          ].join("\n"),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { stop_reason: string; content: { type: string; text?: string }[] };
  if (data.stop_reason === "refusal") throw new Error("Anthropic declined the request (refusal).");
  const text = data.content.find((b) => b.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text) as { queries: { slot_id: string; query: string }[] };
  return Object.fromEntries(parsed.queries.map((q) => [q.slot_id, q.query]));
}

// ---------------------------------------------------------------------------
// Providers — both return download descriptors; fetchCandidates does the rest
// ---------------------------------------------------------------------------

interface RemotePhoto {
  downloadUrl: string;
  credit: string;
  sourceUrl: string;
}

type Orientation = "landscape" | "portrait" | "square";

function slotOrientation(aspect: string): Orientation {
  const [w, h] = aspect.split(":").map(Number);
  return w > h ? "landscape" : w < h ? "portrait" : "square";
}

async function searchPexels(query: string, orientation: Orientation): Promise<RemotePhoto[]> {
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=${orientation}`,
    { headers: { Authorization: process.env.PEXELS_API_KEY! } }
  );
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    photos: { src: { large2x: string }; photographer: string; url: string }[];
  };
  return data.photos.map((p) => ({
    downloadUrl: p.src.large2x,
    credit: `Photo by ${p.photographer} on Pexels (${p.url})`,
    sourceUrl: p.url,
  }));
}

const LICENSE_LABEL: Record<string, string> = {
  cc0: "CC0",
  pdm: "Public Domain",
  by: "CC BY",
  "by-sa": "CC BY-SA",
};

interface OpenverseResult {
  url: string;
  creator: string | null;
  foreign_landing_url: string;
  license: string;
  license_version: string;
  provider: string;
}

async function openverseSearchOnce(query: string, aspectParam: string | null): Promise<OpenverseResult[]> {
  const url =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
    `&page_size=12&license_type=commercial` +
    (aspectParam ? `&aspect_ratio=${aspectParam}` : "");
  const headers = { "User-Agent": "curbside-sites/1.0 (image sourcing script, local dev)" };

  let res = await fetch(url, { headers });
  if (res.status === 429) {
    // Anonymous burst limit is 20/min; one patient retry covers a full run.
    await new Promise((r) => setTimeout(r, 30_000));
    res = await fetch(url, { headers });
  }
  if (!res.ok) throw new Error(`Openverse ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { results: OpenverseResult[] };
  return data.results;
}

async function searchOpenverse(query: string, orientation: Orientation): Promise<RemotePhoto[]> {
  const aspectParam = orientation === "landscape" ? "wide" : orientation === "portrait" ? "tall" : "square";

  // Openverse search is effectively AND across terms, so the manifest's
  // Pexels-flavored 5-6 word queries often match nothing. Relax by dropping
  // trailing words (queries lead with the subject), then drop the aspect
  // filter as a last resort.
  const words = query.trim().split(/\s+/);
  const variants: string[] = [];
  for (let len = Math.min(words.length, 5); len >= 2; len--) {
    variants.push(words.slice(0, len).join(" "));
  }
  if (variants.length === 0) variants.push(query);

  // One or two hits are usually text-match noise (cartoons, scans, LEGO);
  // keep relaxing until a variant returns a real result set, but hold on to
  // the best thin set as a fallback.
  const MIN_RESULTS = 3;
  let results: OpenverseResult[] = [];
  outer: for (const aspect of [aspectParam, null]) {
    for (const variant of variants) {
      const found = await openverseSearchOnce(variant, aspect);
      if (found.length >= MIN_RESULTS) {
        results = found;
        break outer;
      }
      if (found.length > results.length) results = found;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Photos are almost always JPEG; PNG/SVG results are usually diagrams,
  // patent drawings, or logos — exactly what a business site must not show.
  const isJpeg = (u: string) => /\.jpe?g($|\?)/i.test(u);
  results.sort((a, b) => Number(isJpeg(b.url)) - Number(isJpeg(a.url)));

  return results.map((p) => {
    const license = LICENSE_LABEL[p.license] ?? `CC ${p.license.toUpperCase()}`;
    const version = p.license_version && !["cc0", "pdm"].includes(p.license) ? ` ${p.license_version}` : "";
    return {
      downloadUrl: p.url,
      credit: `Photo by ${p.creator ?? "unknown"} via ${p.provider}, ${license}${version} (${p.foreign_landing_url})`,
      sourceUrl: p.foreign_landing_url,
    };
  });
}

export function activeProvider(): "pexels" | "openverse" {
  return process.env.PEXELS_API_KEY ? "pexels" : "openverse";
}

// ---------------------------------------------------------------------------
// Search + download, with a local candidate cache
// ---------------------------------------------------------------------------

export async function fetchCandidates(
  slug: string,
  slot: Slot,
  query: string,
  refresh = false
): Promise<{ provider: string; candidates: Candidate[]; cached: boolean; appliedPrior?: number }> {
  const dir = join(candidatesDir(slug), slot.slot_id);
  const metaPath = join(dir, "meta.json");

  if (!refresh && existsSync(metaPath)) {
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
      provider?: string;
      candidates: Candidate[];
      applied?: number;
    };
    const intact = meta.candidates.every((c) => existsSync(join(dir, `${c.n}.jpg`)));
    if (intact && meta.candidates.length > 0) {
      return {
        provider: meta.provider ?? "cache",
        candidates: meta.candidates,
        cached: true,
        appliedPrior: meta.applied,
      };
    }
  }

  const provider = activeProvider();
  const orientation = slotOrientation(slot.aspect);
  const photos =
    provider === "pexels" ? await searchPexels(query, orientation) : await searchOpenverse(query, orientation);

  await mkdir(dir, { recursive: true });
  const out: Candidate[] = [];
  for (const photo of photos) {
    if (out.length >= CANDIDATES_PER_SLOT) break;
    try {
      const img = await fetch(photo.downloadUrl, {
        signal: AbortSignal.timeout(20_000),
        // Wikimedia and friends 429 anonymous UA-less downloads.
        headers: { "User-Agent": "curbside-sites/1.0 (image sourcing script, local dev)" },
      });
      if (!img.ok) continue;
      const type = img.headers.get("content-type") ?? "";
      if (!type.startsWith("image/") || type.includes("svg")) continue;
      const n = out.length + 1;
      const file = join(dir, `${n}.jpg`);
      await writeFile(file, Buffer.from(await img.arrayBuffer()));
      out.push({ n, file, credit: photo.credit, sourceUrl: photo.sourceUrl });
    } catch {
      continue; // dead link in the index — skip, keep filling the sheet
    }
  }
  await writeFile(metaPath, JSON.stringify({ query, provider, candidates: out }, null, 2));
  return { provider, candidates: out, cached: false };
}

// ---------------------------------------------------------------------------
// The contact sheet — the human review gate
// ---------------------------------------------------------------------------

export function contactSheet(slug: string, rows: SlotResult[], applied?: Map<string, number>): string {
  const section = (r: SlotResult) => `
  <section>
    <h2>${r.slot.slot_id} <small>(${r.slot.aspect} — ${r.slot.purpose} · via ${r.provider})</small></h2>
    <p class="q">query: “${r.query}”</p>
    <div class="grid">
      ${r.candidates
        .map(
          (c) => `
      <figure${applied?.get(r.slot.slot_id) === c.n ? ' class="applied"' : ""}>
        <img src="${r.slot.slot_id}/${c.n}.jpg" loading="lazy" alt="candidate ${c.n}">
        <figcaption>
          <strong>#${c.n}</strong>${applied?.get(r.slot.slot_id) === c.n ? " <em>· APPLIED — swap if it fails review</em>" : ""} — ${c.credit.replace(/\(https?:[^)]*\)/, "")} <a href="${c.sourceUrl}">source</a><br>
          <code>npm run images:source ${slug} -- --apply ${r.slot.slot_id}=${c.n}</code>
        </figcaption>
      </figure>`
        )
        .join("")}
    </div>
  </section>`;

  return `<!doctype html><meta charset="utf-8"><title>Image review — ${slug}</title>
<style>
  body{font:14px/1.5 system-ui;margin:2rem;max-width:1200px}
  h1{font-size:1.4rem} h2{margin:2.5rem 0 .25rem} small{color:#666;font-weight:normal}
  .q{color:#666;margin:0 0 .75rem} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem}
  figure{margin:0} img{width:100%;height:180px;object-fit:cover;border:1px solid #ccc}
  figure.applied img{border:3px solid #16a34a} figure.applied em{color:#16a34a;font-style:normal}
  figcaption{font-size:12px;color:#444;margin-top:.25rem} code{background:#f4f4f4;padding:1px 4px;font-size:11px;display:inline-block;margin-top:2px}
  .warn{background:#fff3cd;border:1px solid #ffe69c;padding:.75rem 1rem}
</style>
<h1>Image candidates — ${slug}</h1>
<p class="warn"><strong>Look at every image before this site ships (the spec means it).</strong> Reject on sight:
another business's name or phone in frame, readable plates, wrong region for the brand, wrong subject
class, cluttered amateur settings, a vibe that fights the brand. Expect to reject a third to half.
${applied ? "Green-bordered picks were auto-applied for the demo — replace any that fail review before go-live." : ""}</p>
${rows.map(section).join("\n")}`;
}

// ---------------------------------------------------------------------------
// Apply — write winners into uploads + the images manifest
// ---------------------------------------------------------------------------

export async function applyChoices(slug: string, choices: Map<string, number>, quiet = false) {
  await ownerDb(async (db) => {
    const { rows } = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
    if (!rows[0]) throw new Error(`no tenant '${slug}'`);
    const tenantId = rows[0].id;

    for (const [slotId, n] of choices) {
      const dir = join(candidatesDir(slug), slotId);
      const metaPath = join(dir, "meta.json");
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
        query: string;
        provider?: string;
        candidates: Candidate[];
        applied?: number;
      };
      const candidate = meta.candidates.find((c) => c.n === n);
      if (!candidate) throw new Error(`${slotId}: no candidate #${n} — run the fetch step first`);

      // Winners are renamed to their slot so the client can later drop in
      // their own photo under the same name with zero code edits (Part 10).
      await mkdir(uploadsDir(slug), { recursive: true });
      const filename = `${slotId}.jpg`;
      await copyFile(join(dir, String(n) + ".jpg"), join(uploadsDir(slug), filename));

      const { rowCount } = await db.query(
        `UPDATE images SET url = $3, credit = $4 WHERE tenant_id = $1 AND slot_id = $2`,
        [tenantId, slotId, `/uploads/${slug}/${filename}`, candidate.credit]
      );
      if (rowCount === 0) throw new Error(`${slotId}: no images row for tenant '${slug}'`);
      meta.applied = n; // the contact sheet marks this pick on every rebuild
      await writeFile(metaPath, JSON.stringify(meta, null, 2));
      if (!quiet) console.log(`applied ${slotId} ← candidate #${n}`);
    }
  });
}

/**
 * Rebuild review.html from the whole candidate cache — every slot with
 * downloaded candidates, applied picks marked — so partial re-runs and
 * --apply never shrink the review surface to just the slots they touched.
 */
export async function writeSheetFromCache(slug: string): Promise<string | null> {
  const slots = await ownerDb(async (db) => {
    const t = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
    if (!t.rows[0]) throw new Error(`no tenant '${slug}'`);
    const img = await db.query(
      `SELECT slot_id, purpose, search_query, aspect, alt, url FROM images
        WHERE tenant_id = $1 AND purpose <> 'instagram' ORDER BY slot_id`,
      [t.rows[0].id]
    );
    return img.rows as Slot[];
  });

  const rows: SlotResult[] = [];
  const applied = new Map<string, number>();
  for (const slot of slots) {
    const metaPath = join(candidatesDir(slug), slot.slot_id, "meta.json");
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
      query: string;
      provider?: string;
      candidates: Candidate[];
      applied?: number;
    };
    if (meta.candidates.length === 0) continue;
    rows.push({ slot, query: meta.query, provider: meta.provider ?? "cache", candidates: meta.candidates });
    if (meta.applied) applied.set(slot.slot_id, meta.applied);
  }
  if (rows.length === 0) return null;

  const sheet = join(candidatesDir(slug), "review.html");
  await writeFile(sheet, contactSheet(slug, rows, applied.size > 0 ? applied : undefined), "utf8");
  return sheet;
}

// ---------------------------------------------------------------------------
// Full pipeline — CLI and seed both call this
// ---------------------------------------------------------------------------

export async function sourceForTenant(
  slug: string,
  opts: { ai?: boolean; auto?: boolean; refresh?: boolean } = {}
): Promise<void> {
  const { slots, business } = await ownerDb(async (db) => {
    const t = await db.query("SELECT id, business_name FROM tenants WHERE slug = $1", [slug]);
    if (!t.rows[0]) throw new Error(`no tenant '${slug}'`);
    const tenantId = t.rows[0].id;
    const img = await db.query(
      `SELECT slot_id, purpose, search_query, aspect, alt, url FROM images
        WHERE tenant_id = $1 AND purpose <> 'instagram' AND url IS NULL ORDER BY slot_id`,
      [tenantId]
    );
    const bp = await db.query(
      "SELECT nap, tagline, about FROM business_profile WHERE tenant_id = $1",
      [tenantId]
    );
    const services = await db.query(
      "SELECT name FROM services WHERE tenant_id = $1 ORDER BY sort_order",
      [tenantId]
    );
    return {
      slots: img.rows as Slot[],
      business: {
        name: t.rows[0].business_name as string,
        tagline: (bp.rows[0]?.tagline as string) ?? "",
        about: (bp.rows[0]?.about as string) ?? "",
        city: (bp.rows[0]?.nap?.city as string) ?? "",
        region: (bp.rows[0]?.nap?.region as string) ?? "",
        services: services.rows.map((r) => r.name as string),
      } satisfies Business,
    };
  });

  if (slots.length === 0) {
    console.log(`[images] ${slug}: every non-Instagram slot already has an image.`);
    const sheet = await writeSheetFromCache(slug);
    if (sheet) console.log(`[images] contact sheet (for review): ${sheet}`);
    return;
  }

  let queries: Record<string, string> = Object.fromEntries(slots.map((s) => [s.slot_id, s.search_query]));
  if (opts.ai) {
    console.log("[images] asking Claude for narrative-fit queries…");
    queries = { ...queries, ...(await aiTuneQueries(slots, business)) };
    for (const s of slots) console.log(`  ${s.slot_id}: “${queries[s.slot_id]}”`);
  }

  const results: (SlotResult & { appliedPrior?: number })[] = [];
  for (const slot of slots) {
    const query = queries[slot.slot_id] || `${business.services[0] ?? "local service"} ${business.region}`;
    process.stdout.write(`[images] ${slug}/${slot.slot_id} (“${query}”) … `);
    const { provider, candidates, cached, appliedPrior } = await fetchCandidates(slug, slot, query, opts.refresh);
    console.log(`${candidates.length} candidates${cached ? " (cached)" : ` via ${provider}`}`);
    results.push({ slot, query, provider, candidates, appliedPrior });
    // Openverse anonymous burst limit is 20/min — pace fresh searches.
    if (!cached && provider === "openverse") await new Promise((r) => setTimeout(r, 1000));
  }

  if (opts.auto) {
    // A previously reviewed pick (meta.applied) beats candidate #1, so
    // re-seeding reproduces the curated demo instead of undoing the review.
    const applied = new Map(
      results
        .filter((r) => r.candidates.length > 0)
        .map((r) => [
          r.slot.slot_id,
          r.appliedPrior && r.candidates.some((c) => c.n === r.appliedPrior)
            ? r.appliedPrior
            : r.candidates[0].n,
        ])
    );
    if (applied.size > 0) {
      await applyChoices(slug, applied, true);
      console.log(`[images] ${slug}: auto-applied top pick for ${applied.size}/${slots.length} slots.`);
    }
    const missed = results.filter((r) => r.candidates.length === 0).map((r) => r.slot.slot_id);
    if (missed.length > 0) {
      console.log(`[images] no candidates found for: ${missed.join(", ")} (branded placeholders keep serving)`);
    }
  }

  const sheet = await writeSheetFromCache(slug);
  if (sheet) console.log(`[images] contact sheet: ${sheet}`);
  if (opts.auto) {
    console.log(
      "[images] AUTO MODE applied unreviewed picks — fine for a local demo, NOT for go-live.\n" +
        "         Open the sheet, look at every image, and swap any that fail review:\n" +
        `         npm run images:source ${slug} -- --apply <slot>=<n>`
    );
  } else {
    console.log("Open it, LOOK at every image, then apply the winners, e.g.:");
    console.log(`  npm run images:source ${slug} -- --apply hero=2 gallery-1=1`);
  }
}
