/**
 * Change requests (D9): the client says what they want, the parser turns it
 * into a TYPED diff (changeDiffSchema — nothing free-form is ever applied),
 * the diff is rendered back in plain language, and the CLIENT confirms.
 * Never auto-applied.
 *
 * The channel is an adapter: chat.ts now (portal), sms.ts later (Twilio,
 * blocked on A2P 10DLC — ARCHITECTURE §6). Swapping is a config flip.
 */
import type { ChangeDiff } from "@/lib/schemas";

export interface ParsedChange {
  diff: ChangeDiff;
  /** Plain-language confirmation line: "Confirm: Saturday 8:00 AM–2:00 PM?" */
  confirmation: string;
  isDemo: boolean;
}

export interface ChangeParser {
  parse(message: string): Promise<ParsedChange>;
}

/** The channel seam. v1 ships 'chat'; 'sms' is a later config flip. */
export type ChangeRequestChannel = "chat" | "sms";
