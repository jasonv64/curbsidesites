/** Hours helpers — display strings and schema.org openingHoursSpecification. */
import { DAY_KEYS, type DayKey, type Hours } from "@/lib/schemas";

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

const SCHEMA_DAYS: Record<DayKey, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

export function fmt12(t: string): string {
  const h = parseInt(t.slice(0, 2), 10);
  const min = t.slice(3);
  const half = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === "00" ? `${h12} ${half}` : `${h12}:${min} ${half}`;
}

export function dayHoursLabel(ranges: [string, string][] | undefined): string {
  if (!ranges || ranges.length === 0) return "Closed";
  return ranges.map(([o, c]) => `${fmt12(o)} – ${fmt12(c)}`).join(", ");
}

/** Rows for the hours table, mon→sun, always all seven days. */
export function hoursRows(hours: Hours): { day: string; label: string }[] {
  return DAY_KEYS.map((k) => ({ day: DAY_LABELS[k], label: dayHoursLabel(hours[k]) }));
}

/** schema.org openingHoursSpecification entries from the canonical record. */
export function openingHoursSpec(hours: Hours) {
  const spec: object[] = [];
  for (const k of DAY_KEYS) {
    for (const [opens, closes] of hours[k] ?? []) {
      spec.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: SCHEMA_DAYS[k],
        opens,
        closes,
      });
    }
  }
  return spec;
}
