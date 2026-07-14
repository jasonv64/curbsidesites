/**
 * Demo parser: deterministic rules for the most common request — hours
 * changes — so the portal chat demos end-to-end with zero API keys. Anything
 * it can't map escalates (never guesses).
 */
import type { ChangeDiff, DayKey, Hours } from "@/lib/schemas";
import type { ChangeParser, ParsedChange } from "./types";

const DAY_WORDS: Record<string, DayKey> = {
  monday: "mon", mon: "mon",
  tuesday: "tue", tue: "tue", tues: "tue",
  wednesday: "wed", wed: "wed",
  thursday: "thu", thu: "thu", thurs: "thu",
  friday: "fri", fri: "fri",
  saturday: "sat", sat: "sat",
  sunday: "sun", sun: "sun",
};

const DAY_LABEL: Record<DayKey, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

function to24h(raw: string, half: "am" | "pm" | null, defaultPm: boolean): string | null {
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ?? "00";
  if (h < 1 || h > 23) return null;
  const isPm = half === "pm" || (half === null && defaultPm && h < 12 && h !== 0);
  if (isPm && h < 12) h += 12;
  if (half === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function fmt12(t: string): string {
  const h = parseInt(t.slice(0, 2), 10);
  const min = t.slice(3);
  const half = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === "00" ? `${h12}:00 ${half}` : `${h12}:${min} ${half}`;
}

export function demoChangeParser(currentHours: Hours): ChangeParser {
  return {
    async parse(message: string): Promise<ParsedChange> {
      const lower = message.toLowerCase();

      const day = Object.keys(DAY_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(lower));
      if (day) {
        const dayKey = DAY_WORDS[day];
        if (/\b(closed?|close (us )?down|no hours)\b/.test(lower)) {
          const hours: Hours = { ...currentHours, [dayKey]: [] };
          return {
            diff: { kind: "hours_update", hours } satisfies ChangeDiff,
            confirmation: `Confirm: ${DAY_LABEL[dayKey]} — closed?`,
            isDemo: true,
          };
        }
        // "make saturday 8-2", "saturday 8am to 2:30pm", "sat 8:00-14:00"
        const range = lower.match(
          /(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:-|–|to|until)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?/
        );
        if (range) {
          const open = to24h(range[1], (range[2] as "am" | "pm") ?? null, false);
          const close = to24h(range[3], (range[4] as "am" | "pm") ?? null, true);
          if (open && close && open < close) {
            const hours: Hours = { ...currentHours, [dayKey]: [[open, close]] };
            return {
              diff: { kind: "hours_update", hours } satisfies ChangeDiff,
              confirmation: `Confirm: ${DAY_LABEL[dayKey]} ${fmt12(open)}–${fmt12(close)}?`,
              isDemo: true,
            };
          }
        }
      }

      const tagline = message.match(/tagline (?:to|should (?:be|say)|says?)\s*[:"]?\s*(.{3,200})/i);
      if (tagline) {
        const t = tagline[1].trim().replace(/["']$/, "");
        return {
          diff: { kind: "tagline_update", tagline: t },
          confirmation: `Confirm: change the tagline to "${t}"?`,
          isDemo: true,
        };
      }

      return {
        diff: { kind: "escalate", reason: "demo parser could not map this to a typed change" },
        confirmation:
          "I couldn't turn that into a change I can apply automatically — sending it to the Curbside team, who will handle it and confirm with you.",
        isDemo: true,
      };
    },
  };
}
