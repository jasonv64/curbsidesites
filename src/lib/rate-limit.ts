/**
 * In-memory sliding-window rate limiter for form actions. Per-instance —
 * fine for one Container App replica; if the fleet scales out, each replica
 * gets its own window, which only makes the limit more generous, never a
 * security hole (the honeypot and Zod validation do the real gatekeeping).
 * Revisit with a shared store if abuse ever shows up (noted in README).
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    // cheap sweep so the map can't grow unbounded
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return true;
}
