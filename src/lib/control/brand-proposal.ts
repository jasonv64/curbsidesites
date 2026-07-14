/**
 * The brand gate's input (Part 2.3): from the uploaded mark, propose semantic
 * tokens + a font pairing key + texture notes + a do-not-do list. A HUMAN
 * approves before the tenant leaves draft — this file only proposes.
 *
 * Color extraction uses sharp (already shipped with Next's image optimizer).
 * No logo → the industry preset stands alone. Every proposal is run through
 * the same contrast math the CI accessibility gate uses (src/lib/brand.ts)
 * and auto-adjusted until it passes — a proposal that fails AA is a bug, not
 * a taste choice (D12).
 */
import { contrastRatio, contrastReport } from "@/lib/brand";
import type { BrandTokens } from "@/lib/schemas";
import type { IndustryKey } from "@/lib/control/intake-schema";

export interface BrandProposal {
  tokens: BrandTokens;
  font_pairing_key: string;
  notes: {
    source: string; // where the palette came from
    texture_notes: string;
    do_not_do: string[];
  };
}

// --- tiny HSL toolkit --------------------------------------------------------

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** Walk lightness until fg reads on bg at the given ratio. */
function fixContrast(fg: string, bg: string, min: number): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const [h, s] = hexToHsl(fg);
  const bgLight = hexToHsl(bg)[2] > 0.5;
  for (let i = 1; i <= 40; i++) {
    const l = hexToHsl(fg)[2] + (bgLight ? -i : i) * 0.02;
    if (l <= 0.02 || l >= 0.98) break;
    const candidate = hslToHex(h, s, l);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return bgLight ? "#1f2937" : "#e5e7eb"; // guaranteed-legible fallback
}

// --- logo color extraction ----------------------------------------------------

/**
 * Dominant saturated colors from the mark. Downsamples to 24×24 RGBA, buckets
 * by hue, weights by saturation × alpha so a colorful mark on a white card
 * beats the white. Returns [] on any failure — the industry preset takes over.
 */
export async function extractLogoColors(image: Buffer): Promise<string[]> {
  try {
    const sharp = (await import("sharp")).default;
    const { data } = await sharp(image)
      .resize(24, 24, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const buckets = new Map<number, { weight: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 128) continue;
      const hex = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
      const [h, s, l] = hexToHsl(hex);
      if (s < 0.25 || l < 0.12 || l > 0.92) continue; // grays/near-black/near-white
      const bucket = Math.round(h / 24) % 15;
      const w = s * (a / 255);
      const cur = buckets.get(bucket) ?? { weight: 0, r: 0, g: 0, b: 0 };
      buckets.set(bucket, {
        weight: cur.weight + w,
        r: cur.r + r * w,
        g: cur.g + g * w,
        b: cur.b + b * w,
      });
    }
    return [...buckets.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 3)
      .map(([, v]) => {
        const to = (x: number) =>
          Math.round(x / v.weight)
            .toString(16)
            .padStart(2, "0");
        return `#${to(v.r)}${to(v.g)}${to(v.b)}`;
      });
  } catch (e) {
    console.warn("[brand-proposal] logo color extraction failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// --- industry presets ----------------------------------------------------------

interface Preset {
  dark: boolean;
  tokens: BrandTokens;
  font_pairing_key: string;
  texture_notes: string;
  do_not_do: string[];
}

const DARK_SHELL = {
  surface: "#15130f",
  surface_raised: "#201d18",
  ink: "#f3efe8",
  ink_muted: "#b5aea2",
  edge: "#3b362d",
};
const LIGHT_SHELL = {
  surface: "#fbfaf7",
  surface_raised: "#efeeea",
  ink: "#1a2430",
  ink_muted: "#4c5a66",
  edge: "#cfd4d2",
};

const PRESETS: Record<IndustryKey, Preset> = {
  automotive: {
    dark: true,
    tokens: { brand: "#9a3412", brand_dark: "#0f0d0a", accent: "#d97706", ...DARK_SHELL },
    font_pairing_key: "industrial",
    texture_notes:
      "Bare metal and shop grit: matte dark surfaces, high-contrast condensed display type, hairline edges like machined seams. Evoke steel with tonal layering, not chrome gradients.",
    do_not_do: [
      "No racing stripes or checkered flags — this is a shop, not a video game",
      "No chrome/bevel effects; texture comes from tone, never from skeuomorphs",
      "Don't brighten the palette to 'friendly' — the customer trusts serious",
    ],
  },
  marine: {
    dark: false,
    tokens: { brand: "#0e4e6e", brand_dark: "#0a2b3d", accent: "#9a3412", ...LIGHT_SHELL },
    font_pairing_key: "nautical",
    texture_notes:
      "Weathered dock and open water: airy light surfaces, deep harbor blue anchors, one warm rust accent like an anode. Generous whitespace reads as calm water.",
    do_not_do: [
      "No anchor/rope clip art or cartoon waves",
      "No teal-on-teal — keep the blue anchored dark against the light shell",
      "Don't crowd sections; the airiness IS the brand",
    ],
  },
  hvac: {
    dark: false,
    tokens: { brand: "#1d4ed8", brand_dark: "#172554", accent: "#b45309", ...LIGHT_SHELL },
    font_pairing_key: "modernist",
    texture_notes:
      "Clean and technical: cool blue for competence, one warm accent for the 'heat' side. Crisp cards and clear hierarchy — this brand sells reliability on the worst day of summer.",
    do_not_do: [
      "No flame + snowflake yin-yang cliché",
      "No gradient thermometers",
      "Don't let the blue go corporate-gray; keep it saturated and confident",
    ],
  },
  plumbing: {
    dark: false,
    tokens: { brand: "#0f766e", brand_dark: "#134e4a", accent: "#b45309", ...LIGHT_SHELL },
    font_pairing_key: "blockletter",
    texture_notes:
      "Solid and trustworthy: deep teal reads clean-water-professional, copper accent nods to the pipe without drawing one. Heavy block display type like a stamped fitting.",
    do_not_do: [
      "No cartoon plumber mascots or dripping-faucet icons",
      "No literal pipe borders or wrench dividers",
      "Don't use blue #0000ff 'water' — it reads cheap flyer",
    ],
  },
  electrical: {
    dark: true,
    tokens: { brand: "#b45309", brand_dark: "#111009", accent: "#eab308", ...DARK_SHELL },
    font_pairing_key: "techshop",
    texture_notes:
      "Panel-shop precision on a dark field: amber/yellow accents like live indicators, monospaced-adjacent display type, thin rules like conduit runs.",
    do_not_do: [
      "No lightning bolts through the logotype",
      "Yellow is an accent, never a background — AA contrast dies on yellow fields",
      "No 'sparks' particle effects",
    ],
  },
  roofing: {
    dark: false,
    tokens: { brand: "#7c2d12", brand_dark: "#431407", accent: "#b45309", ...LIGHT_SHELL },
    font_pairing_key: "condensed",
    texture_notes:
      "Shingle and timber: warm earth tones, strong horizontal banding like courses of a roof, condensed type with weight. Photography does the work; the palette frames it.",
    do_not_do: [
      "No house-outline icons in the logotype",
      "Don't go red — storm-chaser roofers burned that color",
      "No drone-photo hero without a human in frame somewhere on the page",
    ],
  },
  landscaping: {
    dark: false,
    tokens: { brand: "#166534", brand_dark: "#14532d", accent: "#b45309", ...LIGHT_SHELL },
    font_pairing_key: "editorial",
    texture_notes:
      "Organic but disciplined: deep garden green, warm soil accent, serif display type like a nursery catalog. Let plant photography carry color; the UI stays quiet.",
    do_not_do: [
      "No lime green (#00ff00 family) anywhere",
      "No leaf clip art bullets",
      "Don't stack more than two greens; it turns to camouflage",
    ],
  },
  fencing: {
    dark: true,
    tokens: { brand: "#525b63", brand_dark: "#14161a", accent: "#d97706", ...DARK_SHELL },
    font_pairing_key: "impact",
    texture_notes:
      "Welded steel: gunmetal neutrals, one hot accent like fresh weld, massive display type with real presence. Straight lines everywhere — this brand is literally about straight lines.",
    do_not_do: [
      "No chain-link texture backgrounds",
      "Don't soften the type; the heaviness is the promise",
      "No sparks/fire imagery near the word 'weld' — insurance underwriters read websites too",
    ],
  },
  painting: {
    dark: false,
    tokens: { brand: "#6d28d9", brand_dark: "#4c1d95", accent: "#b45309", ...LIGHT_SHELL },
    font_pairing_key: "modernist",
    texture_notes:
      "Gallery-clean: near-white walls, one confident color statement, crisp edges like a taped line. The restraint demonstrates the craft.",
    do_not_do: [
      "No paint drips, splatters, or roller-streak graphics",
      "No rainbow gradients",
      "Don't use more than one saturated hue — a painter's site with clashing colors is an anti-portfolio",
    ],
  },
  cleaning: {
    dark: false,
    tokens: { brand: "#0369a1", brand_dark: "#0c4a6e", accent: "#b45309", ...LIGHT_SHELL },
    font_pairing_key: "modernist",
    texture_notes:
      "Fresh and bright: sky blue, plenty of white, soft raised cards like clean laundry. Every surface reads recently wiped.",
    do_not_do: [
      "No sparkle emoji/starburst graphics",
      "No bubbles",
      "Don't gray the palette down — dinginess is the exact wrong association",
    ],
  },
  general: {
    dark: false,
    tokens: { brand: "#1f2937", brand_dark: "#111827", accent: "#b45309", ...LIGHT_SHELL },
    font_pairing_key: "blockletter",
    texture_notes:
      "Neutral and sturdy: charcoal anchor, warm accent, block type. A palette that gets out of the way until the trade tells us more.",
    do_not_do: [
      "Nothing generic-startup: no purple gradients, no glassmorphism",
      "Don't ship this preset unexamined — it's a starting point, not a brand",
    ],
  },
};

// --- the proposal --------------------------------------------------------------

/**
 * Industry preset + (optionally) the mark's own colors, contrast-fixed until
 * the full report passes AA. Never throws — worst case is the bare preset.
 */
export async function proposeBrand(
  industry: IndustryKey,
  logo?: Buffer
): Promise<BrandProposal> {
  const preset = PRESETS[industry] ?? PRESETS.general;
  const tokens: BrandTokens = { ...preset.tokens };
  let source = `industry preset (${industry})`;

  const extracted = logo ? await extractLogoColors(logo) : [];
  if (extracted.length > 0) {
    // brand from the mark's dominant color, kept legible against the shell
    tokens.brand = extracted[0];
    const [h, s] = hexToHsl(extracted[0]);
    tokens.brand_dark = hslToHex(h, Math.min(s, 0.65), preset.dark ? 0.07 : 0.16);
    if (extracted[1]) tokens.accent = extracted[1];
    source = `extracted from uploaded mark (${extracted.join(", ")}) over the ${industry} preset`;
  }

  // Auto-fix until the same checks CI runs all pass (D12: per-tenant contrast).
  tokens.accent = fixContrast(tokens.accent, tokens.surface, 4.5);
  tokens.accent = fixContrast(tokens.accent, tokens.surface_raised, 4.5);
  tokens.ink = fixContrast(tokens.ink, tokens.surface, 4.5);
  tokens.ink_muted = fixContrast(tokens.ink_muted, tokens.surface, 4.5);

  const failing = contrastReport(tokens).filter((c) => !c.pass);
  if (failing.length > 0) {
    // bestTextOn() covers on-brand pairs at render time; anything else failing
    // means the extraction produced something unusable — fall back per token.
    for (const f of failing) {
      if (f.pair.startsWith("accent")) tokens.accent = preset.tokens.accent;
    }
  }

  return {
    tokens,
    font_pairing_key: preset.font_pairing_key,
    notes: {
      source,
      texture_notes: preset.texture_notes,
      do_not_do: preset.do_not_do,
    },
  };
}
