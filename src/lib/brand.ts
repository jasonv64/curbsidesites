/**
 * Brand token plumbing (TENANT-APP Part 6).
 *
 * Tokens live on the tenant's brand row and are emitted as CSS custom
 * properties in a <style> block in that tenant's <head>. Tailwind utilities
 * reference the variables (see globals.css @theme). NO RAW HEX IN COMPONENTS.
 *
 * Also home to the WCAG contrast math the CI accessibility gate and the
 * (future, Part 14) write-time contrast validation both use.
 */
import { brandTokensSchema, type BrandTokens } from "@/lib/schemas";
import { getPairing } from "@/lib/font-pairings";

/** Neutral fallback palette — used when a tenant has no brand row yet. */
export const FALLBACK_TOKENS: BrandTokens = {
  brand: "#1f2937",
  brand_dark: "#111827",
  surface: "#ffffff",
  surface_raised: "#f3f4f6",
  ink: "#111827",
  ink_muted: "#4b5563",
  edge: "#d1d5db",
  accent: "#b45309",
};

// --- WCAG 2.x relative luminance / contrast --------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** White or near-black — whichever reads better on the given background. */
export function bestTextOn(bg: string): string {
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#0a0a0a") ? "#ffffff" : "#0a0a0a";
}

/**
 * The pairings the design system actually uses (Part 14's guardrail knows
 * exactly what to validate because this list exists).
 */
export function contrastReport(tokens: BrandTokens) {
  const checks: { pair: string; fg: string; bg: string; ratio: number; min: number }[] = [
    { pair: "ink on surface", fg: tokens.ink, bg: tokens.surface, ratio: 0, min: 4.5 },
    { pair: "ink on surface_raised", fg: tokens.ink, bg: tokens.surface_raised, ratio: 0, min: 4.5 },
    { pair: "ink_muted on surface", fg: tokens.ink_muted, bg: tokens.surface, ratio: 0, min: 4.5 },
    { pair: "on-brand text on brand", fg: bestTextOn(tokens.brand), bg: tokens.brand, ratio: 0, min: 4.5 },
    { pair: "on-accent text on accent", fg: bestTextOn(tokens.accent), bg: tokens.accent, ratio: 0, min: 4.5 },
    { pair: "on-brand-dark text on brand_dark", fg: bestTextOn(tokens.brand_dark), bg: tokens.brand_dark, ratio: 0, min: 4.5 },
    // accent doubles as emphasis TEXT (links, stat numbers) on both surfaces
    { pair: "accent as text on surface", fg: tokens.accent, bg: tokens.surface, ratio: 0, min: 4.5 },
    { pair: "accent as text on surface_raised", fg: tokens.accent, bg: tokens.surface_raised, ratio: 0, min: 4.5 },
  ];
  for (const c of checks) c.ratio = contrastRatio(c.fg, c.bg);
  return checks.map((c) => ({ ...c, pass: c.ratio >= c.min }));
}

// --- The injected style block ----------------------------------------------

export function resolveTokens(raw: unknown): BrandTokens {
  const parsed = brandTokensSchema.safeParse(raw);
  if (!parsed.success) {
    if (raw != null) console.error("brand.tokens failed validation; using fallback palette");
    return FALLBACK_TOKENS;
  }
  return parsed.data;
}

/**
 * CSS for the tenant <style> block: the eight semantic tokens, two derived
 * on-* text colors, and the font pairing indirection (build-time faces,
 * request-time selection — the Part 6 trade).
 */
export function brandStyle(tokens: BrandTokens, fontPairingKey: string | null | undefined): string {
  const p = getPairing(fontPairingKey);
  return [
    ":root{",
    `--brand:${tokens.brand};`,
    `--brand-dark:${tokens.brand_dark};`,
    `--surface:${tokens.surface};`,
    `--surface-raised:${tokens.surface_raised};`,
    `--ink:${tokens.ink};`,
    `--ink-muted:${tokens.ink_muted};`,
    `--edge:${tokens.edge};`,
    `--accent:${tokens.accent};`,
    `--on-brand:${bestTextOn(tokens.brand)};`,
    `--on-brand-dark:${bestTextOn(tokens.brand_dark)};`,
    `--on-accent:${bestTextOn(tokens.accent)};`,
    `--font-display:${p.display},${p.displayFallback};`,
    `--font-body:${p.body},${p.bodyFallback};`,
    `--display-case:${p.displayUppercase ? "uppercase" : "none"};`,
    `--display-tracking:${p.displayUppercase ? "0.02em" : "-0.01em"};`,
    "}",
  ].join("");
}
