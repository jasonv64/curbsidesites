import type { TenantBundle } from "@/lib/tenant";
import type { InstagramFeed } from "./types";

/**
 * Demo feed: six branded placeholder tiles with plausible shop captions.
 * Labeled "sample feed" by the section per D5.
 */
export function demoInstagram(bundle: TenantBundle): InstagramFeed {
  const handle = bundle.profile?.socials?.instagram ?? null;
  const captions = [
    "Fresh out of the bay and back on the road.",
    "Before / after. The difference is in the details.",
    "This one fought us. We won.",
    "Customer pickup day — the best day.",
    "In the shop this week.",
    "Weekend-ready. Come see us.",
  ];
  return {
    handle,
    isDemo: true,
    posts: captions.map((caption, i) => ({
      id: `demo-${i + 1}`,
      caption,
      imageUrl: null, // TenantImage renders the branded placeholder
      permalink: handle ? `https://instagram.com/${handle.replace(/^@/, "")}` : null,
    })),
  };
}
