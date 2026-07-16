import type { GbpSnapshot } from "./types";

/**
 * Demo GBP: we have no manager access, so the honest answer is "couldn't
 * look" — available:false, which the drift monitor records as ok=NULL
 * (unchecked), never as a pass. Faking a match here would defeat the entire
 * point of a drift monitor.
 */
export async function demoGbpSnapshot(): Promise<GbpSnapshot> {
  return { available: false, nap: null, categories: [], source: "demo" };
}
