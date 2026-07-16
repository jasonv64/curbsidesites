/**
 * Growth-plane demo data (GROWTH-PLANE Part 9.2): three months of realistic,
 * clearly-flagged demo instrumentation for the two demo tenants, then the
 * SAMPLE monthly report — the artifact you could actually hand a prospect.
 *
 * Every row written here is is_demo = true (D5). Sample reports render with
 * a "demonstration data" band on every page and are never emailed (Inv. 12).
 *
 * Idempotent. Run AFTER db:seed. Usage: npm run db:seed:growth
 */
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

// Deterministic pseudo-randoms so re-seeds reproduce the same "months".
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOURCE_MIX: [string, number][] = [
  ["organic", 0.5],
  ["direct", 0.2],
  ["gbp", 0.17],
  ["instagram", 0.06],
  ["referral", 0.07],
];
const pickSource = (r: number) => {
  let acc = 0;
  for (const [s, w] of SOURCE_MIX) {
    acc += w;
    if (r < acc) return s;
  }
  return "direct";
};

const LEAD_NAMES = [
  "Marcus Trejo", "Danielle Whitfield", "Ray Okafor", "Jenny Alvarez", "Tom Brandt",
  "Priya Natarajan", "Cody Simmons", "Alicia Fuentes", "Bill Hartman", "Renee Castillo",
  "Devon Marsh", "Karla Nguyen", "Stu Pemberton", "Gabby Rios", "Hank Voss",
];

async function main() {
  const { controlOne, controlQuery } = await import("../src/lib/control/db");
  const { ensureTrackedTerms, demoPosition } = await import("../src/lib/growth/rank-tracking");
  const { checkNapDrift } = await import("../src/lib/growth/nap-drift");
  const { lastCompleteMonth, monthsBefore } = await import("../src/lib/growth/period");
  const { generateReport, renderReportPdf } = await import("../src/lib/growth/report-run");
  const { renderReportHtml } = await import("../src/lib/growth/report-html");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  // Per-tenant monthly contact volumes [2 months ago, last month] — last month
  // up for Iron Ridge (the "good month" sample), slightly down for Delta (the
  // honest-down-month sample).
  const TENANTS: { slug: string; monthlyTotals: [number, number, number]; services: string[] }[] = [
    { slug: "iron-ridge-offroad", monthlyTotals: [33, 39, 47], services: [] },
    { slug: "delta-marine-service", monthlyTotals: [30, 34, 28], services: [] },
  ];

  const last = lastCompleteMonth();
  const months = [monthsBefore(last, 2), monthsBefore(last, 1), last];

  for (const t of TENANTS) {
    const tenant = await controlOne<{ id: string; business_name: string; slug: string }>(
      "SELECT id, business_name, slug FROM tenants WHERE slug = $1",
      [t.slug]
    );
    if (!tenant) {
      console.warn(`${t.slug}: not found — run npm run db:seed first`);
      continue;
    }
    const rand = mulberry32(1 + t.slug.length * 7919);

    // Idempotency: wipe THIS script's demo rows, keep db:seed's demo leads/reviews.
    await controlQuery("DELETE FROM events WHERE tenant_id = $1 AND is_demo = true", [tenant.id]);
    await controlQuery(
      "DELETE FROM leads WHERE tenant_id = $1 AND is_demo = true AND message LIKE 'Growth-plane sample lead%'",
      [tenant.id]
    );
    await controlQuery("DELETE FROM rank_snapshots WHERE tenant_id = $1 AND is_demo = true", [tenant.id]);

    // ---- Conversion events + form leads, month by month ---------------------
    for (let m = 0; m < months.length; m++) {
      const period = months[m];
      const total = t.monthlyTotals[m];
      const spanMs = period.end.getTime() - period.start.getTime();
      // Mix: ~45% call taps, ~30% form submits (leads), ~25% direction taps.
      const calls = Math.round(total * 0.45);
      const forms = Math.round(total * 0.3);
      const maps = total - calls - forms;

      const at = () => new Date(period.start.getTime() + rand() * spanMs).toISOString();
      for (let i = 0; i < calls; i++) {
        await controlQuery(
          `INSERT INTO events (tenant_id, type, payload, created_at, is_demo)
           VALUES ($1, 'call_tap', $2, $3, true)`,
          [tenant.id, JSON.stringify({ source: pickSource(rand()) }), at()]
        );
      }
      for (let i = 0; i < maps; i++) {
        await controlQuery(
          `INSERT INTO events (tenant_id, type, payload, created_at, is_demo)
           VALUES ($1, 'map_tap', $2, $3, true)`,
          [tenant.id, JSON.stringify({ source: pickSource(rand()) }), at()]
        );
      }
      for (let i = 0; i < forms; i++) {
        const name = LEAD_NAMES[Math.floor(rand() * LEAD_NAMES.length)];
        await controlQuery(
          `INSERT INTO leads (tenant_id, name, contact, message, source, status, is_demo, created_at)
           VALUES ($1, $2, $3, 'Growth-plane sample lead (monthly report demo data).', $4, $5, true, $6)`,
          [
            tenant.id,
            name,
            JSON.stringify({ email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com` }),
            pickSource(rand()),
            rand() < 0.35 ? "won" : rand() < 0.6 ? "contacted" : "new",
            at(),
          ]
        );
      }
    }

    // ---- A few fresh demo reviews last month (count + rating movement) ------
    const freshReviews: [string, number, string][] = [
      ["Local customer", 5, "Fast, straight answers, fair price. Exactly what you want."],
      ["Repeat customer", 5, "Second job with these guys — same result. Booked the next one already."],
      ["First-timer", 4, "Solid work. Communication could be a hair quicker but the result is right."],
    ];
    for (let i = 0; i < freshReviews.length; i++) {
      const [author, rating, body] = freshReviews[i];
      const when = new Date(last.start.getTime() + (i + 1) * 6 * 86_400_000).toISOString();
      await controlQuery(
        `INSERT INTO reviews (tenant_id, source, external_id, author, rating, body, published_at, is_demo)
         SELECT $1, 'google', $2, $3, $4, $5, $6, true
          WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE tenant_id = $1 AND external_id = $2)`,
        [tenant.id, `demo-growth-${i}`, author, rating, body, when]
      );
    }

    // ---- Tracked terms + 12 weeks of demo rank snapshots ---------------------
    await ensureTrackedTerms(tenant.id);
    const terms = await controlQuery<{ id: string; term: string }>(
      "SELECT id, term FROM tracked_terms WHERE tenant_id = $1 AND retired_at IS NULL",
      [tenant.id]
    );
    const nowWeek = Math.floor(Date.now() / (7 * 24 * 3600_000));
    for (const term of terms) {
      for (let w = 12; w >= 0; w--) {
        const checkedOn = new Date(Date.now() - w * 7 * 86_400_000).toISOString().slice(0, 10);
        await controlQuery(
          `INSERT INTO rank_snapshots (tenant_id, term_id, position, checked_on, is_demo)
           VALUES ($1, $2, $3, $4, true) ON CONFLICT (term_id, checked_on) DO NOTHING`,
          [tenant.id, term.id, demoPosition(term.term, nowWeek - w), checkedOn]
        );
      }
    }

    // ---- NAP checks (real checks of our own surfaces — these aren't demo) ---
    await checkNapDrift({ tenant_id: tenant.id, slug: tenant.slug, business_name: tenant.business_name });

    // ---- Sample "next month" note -------------------------------------------
    await controlQuery(
      `INSERT INTO report_notes (tenant_id, why_note, next_note)
       VALUES ($1, NULL, $2) ON CONFLICT (tenant_id) DO UPDATE SET next_note = $2, updated_at = now()`,
      [
        tenant.id,
        t.slug === "iron-ridge-offroad"
          ? "Two new articles targeting Johnson Valley search terms, and we start review asks after every won job."
          : "One service-season article, and we chase the two directories still showing your old hours.",
      ]
    );

    // ---- Backdate one seeded post into last month so the report's "What
    //      Curbside did" section demonstrates itself in the sample ------------
    await controlQuery(
      `UPDATE content SET published_at = $2
        WHERE id = (SELECT id FROM content WHERE tenant_id = $1 AND type = 'post'
                     AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1)`,
      [tenant.id, new Date(last.start.getTime() + 9 * 86_400_000)]
    );

    // ---- The sample report ----------------------------------------------------
    const report = await generateReport(tenant.id, last, "sample", "seed-growth");
    const html = renderReportHtml(report.data);
    const dir = join(process.cwd(), ".data", "reports", tenant.slug);
    await mkdir(dir, { recursive: true });
    const htmlPath = join(dir, `${report.data.period.key}-sample.html`);
    await writeFile(htmlPath, html, "utf8");
    const pdf = await renderReportPdf(report.id).catch((e) => {
      console.warn(`${t.slug}: PDF skipped —`, e instanceof Error ? e.message : e);
      return null;
    });
    console.log(
      `${t.slug}: ${report.data.contacts.total} contacts in ${report.data.period.label} · sample report → ${htmlPath}${pdf ? ` + ${pdf}` : ""}`
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
