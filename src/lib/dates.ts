/**
 * Date helpers. THE TRAP (TENANT-APP Part 8): `new Date("2026-07-04")` parses
 * as UTC midnight and renders July 3rd in every western timezone. Frontmatter
 * dates are plain YYYY-MM-DD strings; format them pinned to noon.
 */

export function formatPostDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  const noon = new Date(y, m - 1, d, 12); // local noon — date can't roll over
  return noon.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** ~200 wpm, floor 1 minute. */
export function readingTimeMinutes(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}
