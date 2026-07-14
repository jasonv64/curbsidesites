/**
 * Branded SVG placeholders (TENANT-APP Part 10): every image slot renders in
 * the tenant's palette at the correct aspect ratio, so a tenant with ZERO
 * uploaded images still looks finished and nothing ever 404s.
 * Deterministic per slot — no randomness, snapshots stay stable.
 */
import type { BrandTokens } from "@/lib/schemas";

export function parseAspect(aspect: string): { w: number; h: number } {
  const m = aspect.match(/^(\d+):(\d+)$/);
  if (!m) return { w: 16, h: 9 };
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Layered composition: brand-dark field, a broad diagonal brand panel,
 * accent seam lines, and a fine grid texture. Reads as deliberate art
 * direction, not a missing image. Photos never carry text (Part 10), and
 * neither do these.
 */
export function placeholderSvg(slot: string, aspect: string, tokens: BrandTokens): string {
  const { w, h } = parseAspect(aspect);
  const W = 1600;
  const H = Math.round((W * h) / w);
  const seed = hashCode(slot);
  const angle = [18, -14, 24, -22][seed % 4];
  const panelX = 0.25 + (seed % 5) * 0.1; // 0.25–0.65 of width
  const px = Math.round(W * panelX);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${tokens.brand_dark}"/>
      <stop offset="1" stop-color="${tokens.brand}"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="${tokens.edge}" stroke-opacity="0.12" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <g transform="rotate(${angle} ${px} ${H / 2})">
    <rect x="${px - W}" y="${H * 0.18}" width="${W * 2}" height="${H * 0.42}" fill="${tokens.brand}" opacity="0.55"/>
    <rect x="${px - W}" y="${H * 0.6}" width="${W * 2}" height="14" fill="${tokens.accent}" opacity="0.85"/>
    <rect x="${px - W}" y="${H * 0.16 - 10}" width="${W * 2}" height="6" fill="${tokens.accent}" opacity="0.4"/>
  </g>
  <circle cx="${W * 0.82}" cy="${H * 0.24}" r="${Math.min(W, H) * 0.05}" fill="none" stroke="${tokens.accent}" stroke-opacity="0.5" stroke-width="3"/>
</svg>`;
}
