/**
 * Report periods. The monthly boundary is midnight AMERICA/LOS_ANGELES, not
 * UTC — Curbside's clients are California businesses (D12 rationale), and a
 * UTC boundary would file every evening conversion from the 31st under the
 * wrong month. `new Date(Date.UTC(y, m, 1))` is exactly the bug this file
 * exists to prevent; see tests/growth-scheduler.test.ts.
 */

export const REPORT_TZ = "America/Los_Angeles";

export interface ReportPeriod {
  year: number;
  month: number; // 1-12
  start: Date; // inclusive, tz-midnight
  end: Date; // exclusive, tz-midnight of the next month
  label: string; // "June 2026"
}

/** What time is it in the report timezone at this instant? (parts, not a Date) */
function tzParts(d: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

/**
 * The UTC instant of midnight in REPORT_TZ on the given calendar date.
 * Start from the UTC guess and correct by the observed tz offset — two
 * passes converge because the offset is stable near midnight (DST switches
 * at 02:00 local).
 */
export function tzMidnight(year: number, month: number, day: number): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, 8)); // LA is UTC-8 or -7
  for (let i = 0; i < 3; i++) {
    const p = tzParts(guess);
    const wantUTC = Date.UTC(year, month - 1, day);
    const haveUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour);
    const diff = wantUTC - haveUTC;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

export function monthPeriod(year: number, month: number): ReportPeriod {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    year,
    month,
    start: tzMidnight(year, month, 1),
    end: tzMidnight(nextYear, nextMonth, 1),
    label: `${new Date(Date.UTC(year, month - 1, 15)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${year}`,
  };
}

/** The most recent COMPLETE month in the report timezone, as of `now`. */
export function lastCompleteMonth(now = new Date()): ReportPeriod {
  const p = tzParts(now);
  const year = p.month === 1 ? p.year - 1 : p.year;
  const month = p.month === 1 ? 12 : p.month - 1;
  return monthPeriod(year, month);
}

/** The month N before the given period (n=1 → previous month). */
export function monthsBefore(period: ReportPeriod, n: number): ReportPeriod {
  const idx = period.year * 12 + (period.month - 1) - n;
  return monthPeriod(Math.floor(idx / 12), (idx % 12) + 1);
}

/** "2026-06" — the stable key used in slugs, filenames, and URLs. */
export function periodKey(period: ReportPeriod): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

export function parsePeriodKey(key: string): ReportPeriod | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return monthPeriod(year, month);
}
