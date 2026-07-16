/**
 * Google Business Profile adapter (GROWTH-PLANE Part 7). Manager access,
 * never their login (D8). v1 scope is READ — the NAP drift monitor compares
 * what GBP shows against the canonical record. Posts/Q&A/hours-sync build on
 * the same client later.
 */

export interface GbpNap {
  name: string;
  phone: string; // E.164 or display — compared normalized
  street: string;
  city: string;
  region: string;
  postal: string;
}

export interface GbpSnapshot {
  /** false = we could not actually look (demo mode / no manager access). */
  available: boolean;
  nap: GbpNap | null;
  categories: string[];
  source: "live" | "demo";
}
