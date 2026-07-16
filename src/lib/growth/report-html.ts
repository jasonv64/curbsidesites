/**
 * Renders ReportData as one self-contained HTML document — no external assets,
 * so the same string works in the portal (iframe srcdoc), as an email
 * attachment page, and as the PDF print source.
 *
 * Design brief from the spec: a shop owner must get the point in 60 seconds,
 * standing up, on a phone. One big number, then the breakdown. A bad month is
 * stated plainly, never dressed up (Invariant 12).
 */
import type { ReportData } from "./report";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SOURCE_LABEL: Record<string, string> = {
  organic: "Google search",
  direct: "Came directly",
  gbp: "Google Business Profile",
  instagram: "Instagram",
  referral: "Other sites",
  synthetic: "—",
};

function trendSentence(d: ReportData): { text: string; tone: "up" | "down" | "flat" | "first" } {
  const { total } = d.contacts;
  const prev = d.trend.prev_total;
  if (prev === null) {
    return { text: `This is your first full month of tracking — next month gets a comparison.`, tone: "first" };
  }
  if (total > prev) {
    return { text: `Up from ${prev} in ${d.trend.prev_label}.`, tone: "up" };
  }
  if (total < prev) {
    return { text: `Down from ${prev} in ${d.trend.prev_label} — no way around that number.`, tone: "down" };
  }
  return { text: `Level with ${d.trend.prev_label} (${prev}).`, tone: "flat" };
}

export function renderReportHtml(d: ReportData): string {
  const isExit = d.kind === "exit";
  const isSample = d.kind === "sample";
  const trend = trendSentence(d);

  const sources = Object.entries(d.contacts.by_source)
    .filter(([k]) => k !== "synthetic")
    .sort((a, b) => b[1] - a[1]);

  const ratingDelta =
    d.reviews.avg_rating !== null && d.reviews.prev_avg_rating !== null
      ? Math.round((d.reviews.avg_rating - d.reviews.prev_avg_rating) * 100) / 100
      : null;

  const rankLine = (t: ReportData["search"]["terms"][number]) => {
    const pos = t.position === null ? "not in top 100" : `#${t.position}`;
    if (t.prev_position === null && t.position !== null) return `<strong>${pos}</strong> — newly ranked`;
    if (t.position === null && t.prev_position !== null) return `dropped out (was #${t.prev_position})`;
    if (t.position === t.prev_position) return `<strong>${pos}</strong> — holding`;
    const up = (t.position ?? 101) < (t.prev_position ?? 101);
    return `<strong>${pos}</strong> — ${up ? "up" : "down"} from #${t.prev_position}`;
  };

  // A bad month says so, says why if we know, and says what we're changing.
  const downBlock =
    trend.tone === "down"
      ? `<div class="down-note">
          ${d.why_note ? `<p><strong>Why:</strong> ${esc(d.why_note)}</p>` : `<p>We don't have a single confirmed cause yet. The numbers above are real either way — we'd rather show you a bad month than a dressed-up one.</p>`}
        </div>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(d.business_name)} — ${isExit ? "Final report" : `${esc(d.period.label)} report`}</title>
<style>
  :root { color-scheme: light; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #17181c; background: #fff; line-height: 1.55; }
  .page { max-width: 680px; margin: 0 auto; padding: 32px 20px 60px; }
  .masthead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap;
    border-bottom: 3px solid #17181c; padding-bottom: 10px; }
  .masthead h1 { font-size: 17px; font-weight: 700; letter-spacing: 0.01em; }
  .masthead .period { font-size: 14px; color: #555; }
  .sample-band { background: #17181c; color: #fff; text-align: center; font-family: Arial, sans-serif;
    font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; padding: 7px 10px; }
  .lede { margin-top: 34px; }
  .lede .q { font-family: Arial, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: #666; }
  .lede .big { font-family: Arial, sans-serif; font-size: clamp(64px, 22vw, 120px); font-weight: 800;
    line-height: 1; letter-spacing: -0.02em; margin-top: 6px; }
  .lede .what { font-size: 19px; margin-top: 10px; max-width: 32em; }
  .lede .trend { font-size: 16px; margin-top: 8px; }
  .trend.up::before { content: "▲ "; color: #1a7a3c; }
  .trend.down::before { content: "▼ "; color: #b3261e; }
  .down-note { border-left: 4px solid #b3261e; padding: 10px 14px; margin-top: 14px; background: #faf4f3; font-size: 15px; }
  section { margin-top: 38px; }
  h2 { font-family: Arial, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: #666; border-bottom: 1px solid #d7d7d7; padding-bottom: 6px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #ececec;
    font-size: 16px; }
  .row .n { font-family: Arial, sans-serif; font-weight: 800; }
  .note { font-size: 14px; color: #555; margin-top: 10px; }
  ul.shipped { list-style: none; }
  ul.shipped li { padding: 9px 0 9px 22px; border-bottom: 1px solid #ececec; font-size: 15.5px; position: relative; }
  ul.shipped li::before { content: "✓"; position: absolute; left: 2px; font-family: Arial, sans-serif; font-weight: 800; }
  .next { font-size: 16px; }
  .gaps { margin-top: 44px; border-top: 1px solid #d7d7d7; padding-top: 12px; }
  .gaps p { font-size: 13px; color: #666; margin-top: 6px; }
  .exit-note { margin-top: 30px; border: 2px solid #17181c; padding: 14px 16px; font-size: 15.5px; }
  .footer { margin-top: 48px; font-family: Arial, sans-serif; font-size: 12px; color: #626262; }
  @media print { .page { padding-top: 12px; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
${isSample ? `<div class="sample-band">Sample report — demonstration data, not a real month</div>` : ""}
<div class="page">
  <header class="masthead">
    <h1>${esc(d.business_name)}</h1>
    <span class="period">${isExit ? "Final report · " : ""}${esc(d.period.label)} · Curbside Sites</span>
  </header>

  <div class="lede">
    <p class="q">${isExit ? "Over your time with us" : "This month"}</p>
    <p class="big">${d.contacts.total}</p>
    <p class="what">${d.contacts.total === 1 ? "person" : "people"} tried to contact ${esc(d.business_name)}
      through the site — calls, quote requests, and direction lookups.</p>
    ${!isExit ? `<p class="trend ${trend.tone}">${esc(trend.text)}</p>` : ""}
    ${d.trend.yoy_total !== null && !isExit ? `<p class="trend">Same month last year: ${d.trend.yoy_total}.</p>` : ""}
    ${downBlock}
  </div>

  <section>
    <h2>How they reached out</h2>
    <div class="row"><span>Tapped your phone number</span><span class="n">${d.contacts.by_type.call_tap}</span></div>
    <div class="row"><span>Sent a quote request</span><span class="n">${d.contacts.by_type.form_submit}</span></div>
    <div class="row"><span>Looked up directions</span><span class="n">${d.contacts.by_type.map_tap}</span></div>
  </section>

  <section>
    <h2>Where they came from</h2>
    ${
      sources.length === 0
        ? `<p class="note">No source data this period.</p>`
        : sources
            .map(
              ([s, n]) =>
                `<div class="row"><span>${esc(SOURCE_LABEL[s] ?? s)}</span><span class="n">${n}</span></div>`
            )
            .join("\n    ")
    }
  </section>

  <section>
    <h2>Reviews</h2>
    ${
      d.reviews.available
        ? `<div class="row"><span>New reviews this period</span><span class="n">${d.reviews.new_count}</span></div>
    <div class="row"><span>Total reviews</span><span class="n">${d.reviews.total_count}</span></div>
    <div class="row"><span>Average rating</span><span class="n">${d.reviews.avg_rating?.toFixed(1) ?? "—"}${
      ratingDelta !== null && ratingDelta !== 0
        ? ` <small>(${ratingDelta > 0 ? "+" : ""}${ratingDelta.toFixed(2)})</small>`
        : ""
    }</span></div>`
        : `<p class="note">Review tracking isn't connected yet — once it is, count, rating, and movement appear here.</p>`
    }
  </section>

  <section>
    <h2>Search visibility</h2>
    ${
      d.search.available
        ? d.search.terms
            .map((t) => `<div class="row"><span>“${esc(t.term)}”</span><span>${rankLine(t)}</span></div>`)
            .join("\n    ") +
          `<p class="note">Tracking ${d.search.tracked_count} search ${d.search.tracked_count === 1 ? "term" : "terms"}; showing the movement that matters.</p>`
        : `<p class="note">Rank tracking ${d.search.tracked_count > 0 ? "has no baseline yet — first movement shows next report" : "isn't set up yet"}. No numbers is better than made-up numbers.</p>`
    }
  </section>

  <section>
    <h2>What Curbside did this month</h2>
    ${
      d.shipped.length > 0
        ? `<ul class="shipped">${d.shipped.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
        : `<p class="note">Routine care only this period: hosting, monitoring, backups, and security updates ran quietly.</p>`
    }
  </section>

  ${
    isExit
      ? `<div class="exit-note">This is your final report, and every number in it is yours to keep — along with
         your domain, your leads, your reviews, and a full export of it all. It's been a pleasure. If a neighbor
         needs a site, you know where we are.</div>`
      : `<section>
    <h2>Next month</h2>
    <p class="next">${esc(d.next_note ?? "Steady course: keep the site fast, watch the numbers, and flag anything worth changing.")}</p>
  </section>`
  }

  ${
    d.data_gaps.length > 0
      ? `<div class="gaps"><h2>What this report can and can't see</h2>${d.data_gaps
          .map((g) => `<p>${esc(g)}</p>`)
          .join("")}</div>`
      : ""
  }

  <p class="footer">Prepared by Curbside Sites · generated ${esc(d.generated_at.slice(0, 10))} · every number above is measured, never estimated.</p>
</div>
</body>
</html>`;
}
