/**
 * Call tracking / dynamic number insertion — interface now, provider later.
 *
 * Invariant 6 is the whole design: DNI swaps the number in the RENDERED PAGE
 * ONLY. The canonical NAP number (business_profile.nap) is what JSON-LD,
 * llms.txt, and every citation surface emit, always. A test asserts this.
 */
export interface DisplayNumber {
  /** What the page shows, e.g. "(760) 555-0134". */
  display: string;
  /** tel: target, e.g. "+17605550134". */
  tel: string;
  /** True when DNI substituted a tracking number. */
  tracked: boolean;
}
