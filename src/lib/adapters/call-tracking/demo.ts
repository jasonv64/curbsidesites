import type { Nap } from "@/lib/schemas";
import type { DisplayNumber } from "./types";

/** Demo/off = the canonical NAP number, untouched. */
export function demoDisplayNumber(nap: Nap): DisplayNumber {
  return { display: nap.phone_display, tel: nap.phone_tel, tracked: false };
}
