import type { DisplayNumber } from "./types";

/**
 * Live DNI: the tracking number from config (provisioned with the provider —
 * Twilio, CallRail — when call tracking sells, $99/mo D19). Substitution
 * happens in page components only; JSON-LD and llms.txt never see this.
 */
export function liveDisplayNumber(config: Record<string, string>): DisplayNumber {
  return {
    display: config.dni_display,
    tel: config.dni_tel,
    tracked: true,
  };
}
