import type { Hours } from "@/lib/schemas";
import { DAY_KEYS } from "@/lib/schemas";
import type { BookingAvailability, BookingSlot } from "./types";

/**
 * Demo availability: the next 7 days' real opening hours, morning + afternoon
 * slots. Deterministic (no Math.random) so ISR-cached pages don't drift.
 */
export function demoAvailability(hours: Hours): BookingAvailability {
  const slots: BookingSlot[] = [];
  const now = new Date();
  for (let d = 1; d <= 7 && slots.length < 6; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 12);
    const key = DAY_KEYS[(day.getDay() + 6) % 7]; // JS sunday=0 → our mon-first
    const ranges = hours[key] ?? [];
    if (ranges.length === 0) continue;
    const [open] = ranges[0];
    const openHour = parseInt(open.slice(0, 2), 10);
    for (const hour of [openHour + 1, openHour + 4]) {
      if (slots.length >= 6) break;
      const label = day.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "America/Los_Angeles",
      });
      const ampm = hour >= 12 ? `${hour === 12 ? 12 : hour - 12}:00 PM` : `${hour}:00 AM`;
      slots.push({
        date: day.toISOString().slice(0, 10),
        time: `${String(hour).padStart(2, "0")}:00`,
        label: `${label}, ${ampm}`,
      });
    }
  }
  return { slots, isDemo: true };
}
