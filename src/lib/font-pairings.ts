/**
 * Font pairing DATA — pure strings, importable from anywhere (route handlers,
 * server actions). The actual next/font loaders live in src/lib/fonts.ts,
 * which may ONLY be imported by the root layout: next/font is restricted to
 * the page/layout module graph, and that restriction is why this file exists.
 *
 * Each pairing references CSS variables that fonts.ts registers on <html>.
 * The tenant's brand.font_pairing_key picks one BY KEY (Part 6: next/font is
 * build-time; the database picks a key, never a font).
 */
export interface FontPairing {
  label: string;
  /** CSS var of the display face (headings, big numbers). */
  display: string;
  /** CSS var of the body face. */
  body: string;
  displayFallback: string;
  bodyFallback: string;
  /**
   * Condensed display faces (Bebas, Anton, Teko) read best uppercase with a
   * little tracking; the injected style block consults this.
   */
  displayUppercase: boolean;
}

export const fontPairings: Record<string, FontPairing> = {
  industrial: {
    label: "Industrial — Bebas Neue / Inter",
    display: "var(--f-bebas)", body: "var(--f-inter)",
    displayFallback: "'Arial Narrow', sans-serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: true,
  },
  mechanic: {
    label: "Mechanic — Oswald / Source Sans 3",
    display: "var(--f-oswald)", body: "var(--f-source-sans)",
    displayFallback: "'Arial Narrow', sans-serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: true,
  },
  blockletter: {
    label: "Blockletter — Archivo Black / Archivo",
    display: "var(--f-archivo-black)", body: "var(--f-archivo)",
    displayFallback: "Arial, sans-serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: false,
  },
  modernist: {
    label: "Modernist — Space Grotesk / Inter",
    display: "var(--f-space-grotesk)", body: "var(--f-inter)",
    displayFallback: "Arial, sans-serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: false,
  },
  condensed: {
    label: "Condensed — Barlow Condensed / Barlow",
    display: "var(--f-barlow-condensed)", body: "var(--f-barlow)",
    displayFallback: "'Arial Narrow', sans-serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: true,
  },
  speedway: {
    label: "Speedway — Teko / Rubik",
    display: "var(--f-teko)", body: "var(--f-rubik)",
    displayFallback: "'Arial Narrow', sans-serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: true,
  },
  impact: {
    label: "Impact — Anton / Work Sans",
    display: "var(--f-anton)", body: "var(--f-work-sans)",
    displayFallback: "'Arial Narrow', sans-serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: true,
  },
  nautical: {
    label: "Nautical — League Spartan / Libre Franklin",
    display: "var(--f-league-spartan)", body: "var(--f-libre-franklin)",
    displayFallback: "Arial, sans-serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: false,
  },
  editorial: {
    label: "Editorial — Fraunces / Karla",
    display: "var(--f-fraunces)", body: "var(--f-karla)",
    displayFallback: "Georgia, serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: false,
  },
  techshop: {
    label: "Techshop — Chakra Petch / IBM Plex Sans",
    display: "var(--f-chakra)", body: "var(--f-ibm-plex)",
    displayFallback: "Arial, sans-serif", bodyFallback: "system-ui, sans-serif",
    displayUppercase: false,
  },
};

export const DEFAULT_PAIRING_KEY = "industrial";

export function getPairing(key: string | null | undefined): FontPairing {
  return fontPairings[key ?? ""] ?? fontPairings[DEFAULT_PAIRING_KEY];
}
