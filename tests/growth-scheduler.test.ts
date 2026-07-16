/**
 * The growth scheduler's decision logic (GROWTH-PLANE Parts 2, 9.3) — the
 * staggering, quota, and backoff math is pure on purpose so this file can
 * prove it without a database. Also covers the monthly-boundary timezone
 * trap (README gotcha) and the report renderer's honesty rules (Part 10.8).
 */
import { describe, it, expect } from "vitest";
import {
  backoffDelayMs,
  hash32,
  nextMonthlyRun,
  nextRunAfterSuccess,
  quotaDecision,
  staggerOffsetMs,
  JOB_WINDOW_HOURS,
} from "@/lib/growth/scheduler";
import { lastCompleteMonth, monthPeriod, periodKey, tzMidnight } from "@/lib/growth/period";
import { demoPosition } from "@/lib/growth/rank-tracking";
import { ensureInternalLinks } from "@/lib/growth/content-calendar";
import { renderReportHtml } from "@/lib/growth/report-html";
import type { ReportData } from "@/lib/growth/report";

const WINDOW = JOB_WINDOW_HOURS.reviews_fetch * 3600_000;
const fakeTenantId = (i: number) => `tenant-${i}-${(i * 2654435761) >>> 0}`;

describe("staggering", () => {
  it("is deterministic per tenant+job and inside the window", () => {
    for (let i = 0; i < 50; i++) {
      const id = fakeTenantId(i);
      const a = staggerOffsetMs(id, "reviews_fetch", WINDOW);
      const b = staggerOffsetMs(id, "reviews_fetch", WINDOW);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(WINDOW);
    }
  });

  it("actually spreads 200 tenants across the window (no thundering herd)", () => {
    // Bucket the window into 24 slices; 200 tenants must not clump.
    const buckets = new Array(24).fill(0);
    for (let i = 0; i < 200; i++) {
      const offset = staggerOffsetMs(fakeTenantId(i), "reviews_fetch", WINDOW);
      buckets[Math.floor((offset / WINDOW) * 24)]++;
    }
    const occupied = buckets.filter((n) => n > 0).length;
    const max = Math.max(...buckets);
    expect(occupied).toBeGreaterThanOrEqual(18); // most slices used
    expect(max).toBeLessThan(40); // no slice hoards the fleet
  });

  it("gives the same tenant different slots for different jobs", () => {
    const id = fakeTenantId(7);
    const slots = new Set(
      (["reviews_fetch", "rank_tracking", "nap_drift"] as const).map((j) =>
        staggerOffsetMs(id, j, WINDOW)
      )
    );
    expect(slots.size).toBeGreaterThan(1);
  });

  it("anchors slots absolutely — a late run does not drift the schedule", () => {
    const id = fakeTenantId(3);
    const offset = staggerOffsetMs(id, "rank_tracking", JOB_WINDOW_HOURS.rank_tracking * 3600_000);
    const windowMs = JOB_WINDOW_HOURS.rank_tracking * 3600_000;
    const windowStart = Math.floor(Date.UTC(2026, 6, 6) / windowMs) * windowMs;
    // Run early in the slot's window vs late: both land on the SAME next slot.
    const early = nextRunAfterSuccess(id, "rank_tracking", new Date(windowStart + offset + 1000));
    const late = nextRunAfterSuccess(id, "rank_tracking", new Date(windowStart + offset + windowMs / 2));
    expect(early.getTime()).toBe(late.getTime());
    expect(early.getTime()).toBeGreaterThan(windowStart + offset);
  });
});

describe("month-anchored jobs", () => {
  it("schedules on/after the anchor day, next month once passed", () => {
    const id = fakeTenantId(11);
    const beforeAnchor = new Date(Date.UTC(2026, 5, 1, 0, 0));
    const next = nextMonthlyRun(id, "monthly_report", 2, beforeAnchor);
    expect(next.getTime()).toBeGreaterThan(beforeAnchor.getTime());
    expect(next.getUTCMonth()).toBe(5); // this month — anchor not yet passed
    const afterRun = nextMonthlyRun(id, "monthly_report", 2, next);
    expect(afterRun.getUTCMonth()).toBe(6); // and then next month
  });
});

describe("backoff and quota", () => {
  it("backs off exponentially and caps at 24h", () => {
    expect(backoffDelayMs(0)).toBe(30 * 60_000);
    expect(backoffDelayMs(1)).toBe(60 * 60_000);
    expect(backoffDelayMs(3)).toBe(240 * 60_000);
    expect(backoffDelayMs(10)).toBe(24 * 3600_000);
    expect(backoffDelayMs(50)).toBe(24 * 3600_000); // no overflow nonsense
  });

  it("quota allows to the budget line and not past it", () => {
    expect(quotaDecision(0, 250)).toEqual({ allow: true, remaining: 250 });
    expect(quotaDecision(249, 250)).toEqual({ allow: true, remaining: 1 });
    expect(quotaDecision(250, 250)).toEqual({ allow: false, remaining: 0 });
    expect(quotaDecision(9999, 250)).toEqual({ allow: false, remaining: 0 });
    expect(quotaDecision(248, 250, 5).allow).toBe(false); // batch needs 5, only 2 left
  });

  it("hash32 is stable (schedule slots survive restarts)", () => {
    expect(hash32("iron-ridge-offroad")).toBe(hash32("iron-ridge-offroad"));
    expect(hash32("a")).not.toBe(hash32("b"));
  });
});

describe("monthly boundaries are America/Los_Angeles, not UTC (the timezone trap)", () => {
  it("tzMidnight lands on 08:00 UTC in winter, 07:00 UTC in summer (DST)", () => {
    expect(tzMidnight(2026, 1, 15).toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(tzMidnight(2026, 7, 15).toISOString()).toBe("2026-07-15T07:00:00.000Z");
  });

  it("an evening conversion on the 30th (LA) stays in its month", () => {
    const june = monthPeriod(2026, 6);
    // 2026-06-30 21:30 LA = 2026-07-01 04:30 UTC — a UTC boundary would
    // misfile this into July.
    const eveningTap = new Date("2026-07-01T04:30:00.000Z");
    expect(eveningTap.getTime()).toBeGreaterThanOrEqual(june.start.getTime());
    expect(eveningTap.getTime()).toBeLessThan(june.end.getTime());
  });

  it("lastCompleteMonth respects the LA calendar on the UTC/LA disagreement window", () => {
    // 2026-07-01 02:00 UTC is still June 30 in LA → June isn't complete yet.
    expect(periodKey(lastCompleteMonth(new Date("2026-07-01T02:00:00.000Z")))).toBe("2026-05");
    // By 10:00 UTC it's July 1 in LA → June is complete.
    expect(periodKey(lastCompleteMonth(new Date("2026-07-01T10:00:00.000Z")))).toBe("2026-06");
  });

  it("December wraps the year", () => {
    expect(periodKey(lastCompleteMonth(new Date("2026-01-15T12:00:00.000Z")))).toBe("2025-12");
  });
});

describe("demo rank positions (sample-report fuel, is_demo only)", () => {
  it("is deterministic and in range", () => {
    for (let week = 2900; week < 2930; week++) {
      const a = demoPosition("lift kits victorville", week);
      expect(a).toBe(demoPosition("lift kits victorville", week));
      if (a !== null) {
        expect(a).toBeGreaterThanOrEqual(1);
        expect(a).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("internal links (Part 6: the step everyone skips, enforced in code)", () => {
  const services = [
    { slug: "lift-kits", name: "Lift Kits" },
    { slug: "boat-service", name: "Boat Service" },
  ];

  it("appends service + contact links when missing, picking the relevant service", () => {
    const out = ensureInternalLinks("Some useful post body.", { title: "Leveling kit vs lift kit", tags: [] }, services);
    expect(out).toContain("](/services#lift-kits)");
    expect(out).toContain("](/contact)");
  });

  it("leaves a body alone when both links already exist", () => {
    const body = "See [Lift Kits](/services#lift-kits) and [contact us](/contact).";
    expect(ensureInternalLinks(body, { title: "x", tags: [] }, services)).toBe(body);
  });
});

describe("report renderer honesty (Invariant 12 / Part 10.8)", () => {
  const base: ReportData = {
    kind: "monthly",
    business_name: "Iron Ridge Offroad",
    city: "Victorville",
    period: { key: "2026-06", label: "June 2026", start: "", end: "" },
    contacts: { total: 47, by_type: { call_tap: 21, form_submit: 14, map_tap: 12 }, by_source: { organic: 30, direct: 17 } },
    trend: { prev_total: 39, prev_label: "May 2026", yoy_total: null, yoy_label: "June 2025" },
    reviews: { available: true, new_count: 3, total_count: 41, avg_rating: 4.8, prev_avg_rating: 4.7 },
    search: { available: true, terms: [{ term: "lift kits victorville", position: 3, prev_position: 5 }], tracked_count: 12 },
    shipped: ["Published 2 new articles."],
    why_note: null,
    next_note: null,
    data_gaps: [],
    generated_at: "2026-07-02T00:00:00.000Z",
  };

  it("leads with the big number", () => {
    const html = renderReportHtml(base);
    expect(html).toContain(">47<");
    expect(html.indexOf(">47<")).toBeLessThan(html.indexOf("How they reached out"));
  });

  it("a down month says so, plainly, without a fake explanation", () => {
    const down = { ...base, contacts: { ...base.contacts, total: 12 }, trend: { ...base.trend, prev_total: 39 } };
    const html = renderReportHtml(down);
    expect(html).toContain("Down from 39");
    expect(html).toContain("don't have a single confirmed cause");
  });

  it("missing instrumentation reads as 'not tracked yet', never zeros as achievements", () => {
    const thin: ReportData = {
      ...base,
      reviews: { available: false, new_count: 0, total_count: 0, avg_rating: null, prev_avg_rating: null },
      search: { available: false, terms: [], tracked_count: 0 },
    };
    const html = renderReportHtml(thin);
    expect(html).toContain("Review tracking isn't connected yet");
    expect(html).toContain("Rank tracking");
    expect(html).not.toContain("Total reviews");
  });

  it("sample reports are stamped as samples", () => {
    const html = renderReportHtml({ ...base, kind: "sample" });
    expect(html).toContain("Sample report — demonstration data");
  });

  it("exit reports end graciously and skip the next-month promise (D20)", () => {
    const html = renderReportHtml({ ...base, kind: "exit" });
    expect(html).toContain("final report");
    expect(html).not.toContain("Next month");
  });
});
