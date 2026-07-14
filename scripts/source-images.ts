/**
 * AI-assisted stock image sourcing (TENANT-APP Part 10) — CLI.
 * Core logic lives in scripts/lib/image-sourcing.ts (shared with db:seed,
 * which auto-bootstraps demo images through the same pipeline).
 *
 *   1. (optional, --ai) Claude rewrites each slot's search query to fit the
 *      tenant's actual narrative — region, customers' vehicles, brand voice.
 *   2. Searches the stock provider for each empty slot and downloads the top
 *      candidates to .data/image-candidates/<slug>/<slot>/. Provider: Pexels
 *      when PEXELS_API_KEY is set, otherwise keyless Openverse (CC-licensed).
 *   3. Writes a review.html contact sheet. A HUMAN LOOKS AT EVERY IMAGE
 *      before a site ships — expect to reject a third to half (wrong region,
 *      wrong subject, competitor branding, amateur clutter).
 *   4. --apply slot=N copies the chosen candidate into the tenant's uploads,
 *      sets images.url + credit, and the site picks it up (≤10 min cache
 *      window, or instantly after a portal save touches the tenant).
 *
 * --auto applies the TOP candidate per slot without review — a demo-site
 * bootstrap so new tenants never show bare placeholders. The contact sheet is
 * still written with the applied picks marked; review it before go-live.
 *
 * Keys (ops-side env, never the app):
 *   PEXELS_API_KEY      — free at pexels.com/api. Optional: without it the
 *                         script uses Openverse anonymously.
 *   ANTHROPIC_API_KEY   — only needed with --ai.
 *
 * Usage:
 *   npx tsx scripts/source-images.ts <slug>              # fetch candidates
 *   npx tsx scripts/source-images.ts <slug> --ai         # AI-tuned queries first
 *   npx tsx scripts/source-images.ts <slug> --auto       # fetch + apply top picks
 *   npx tsx scripts/source-images.ts <slug> --refresh    # ignore cached candidates
 *   npx tsx scripts/source-images.ts <slug> --apply hero=2 gallery-1=1
 */
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

import { applyChoices, sourceForTenant, writeSheetFromCache } from "./lib/image-sourcing";

async function main() {
  const [slug, ...rest] = process.argv.slice(2);
  if (!slug) {
    console.error("usage: npx tsx scripts/source-images.ts <slug> [--ai] [--auto] [--refresh] [--apply slot=n ...]");
    process.exit(1);
  }

  const applyArgs = rest.filter((a) => /^[a-z0-9-]+=\d+$/.test(a));
  if (rest.includes("--apply") || applyArgs.length > 0) {
    const choices = new Map(applyArgs.map((a) => {
      const [slot, n] = a.split("=");
      return [slot, parseInt(n, 10)] as const;
    }));
    if (choices.size === 0) throw new Error("--apply needs slot=n pairs, e.g. --apply hero=2");
    await applyChoices(slug, choices);
    await writeSheetFromCache(slug);
    console.log(
      "\nDone. Pages pick this up within the 10-minute cache window; any portal save\n" +
        "for this tenant makes it instant. Direct check: hard-refresh the page."
    );
    return;
  }

  await sourceForTenant(slug, {
    ai: rest.includes("--ai"),
    auto: rest.includes("--auto"),
    refresh: rest.includes("--refresh"),
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
