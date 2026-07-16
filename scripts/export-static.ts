/**
 * Static failover export (D6, TENANT-APP Part 12).
 *
 * Crawls every LIVE tenant through a running server (Host-header addressed)
 * and writes plain-HTML snapshots. Nightly + post-deploy in production,
 * uploading to Azure Blob Storage where Cloudflare serves them on origin
 * failure (Session 4 wires the upload + health check; the alerting surface
 * is the control plane's, Session 2).
 *
 * SEMANTIC verification per Invariant 9, applied to every snapshot page:
 *   - rendered HTML contains this tenant's canonical phone number
 *   - the JSON-LD parses as valid JSON
 * A page that fails is NOT written — a bad snapshot is worse than a stale one.
 *
 * Forms can't work from a static file, so <form>…</form> degrades to a
 * tap-to-call block (tel: keeps working — D6's whole point).
 *
 * Usage: node server running, then  npm run export:static
 *
 * Modes:
 *   default        — crawl EXPORT_BASE_URL (local server), Host-header addressed.
 *   EXPORT_DIRECT=1 — crawl https://<hostname> through the public edge. This is
 *                     the production mode (RUNBOOK.md Phase 7): ACA ingress
 *                     routes by its own FQDN, so Host-header addressing can't
 *                     reach the app from outside; the edge Worker can.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Client } from "pg";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

/**
 * GOTCHA: Node's fetch (undici) silently DROPS a manual Host header — it's
 * spec-forbidden — so Host-addressed multi-tenant requests 404 as "unknown
 * host". node:http has no such rule.
 */
function get(
  base: string,
  path: string,
  host: string
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const u = new URL(base);
  const request = u.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path,
        headers: { Host: host },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

const DIRECT = process.env.EXPORT_DIRECT === "1";
const BASE = process.env.EXPORT_BASE_URL ?? "http://127.0.0.1:3000";
const OUT = join(process.cwd(), ".data", "failover-snapshots");
const PAGES = ["/", "/services", "/about", "/gallery", "/contact", "/blog", "/privacy", "/terms", "/accessibility"];

interface TenantRow {
  id: string;
  slug: string;
  hostname: string;
  phone_display: string;
  phone_tel: string;
}

async function liveTenants(): Promise<TenantRow[]> {
  // Owner locally; the production export job carries only the control-role
  // URL (never owner credentials — RUNBOOK.md Phase 7).
  const db = new Client({
    connectionString: process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL_CONTROL,
  });
  await db.connect();
  try {
    const apex = process.env.PLATFORM_APEX ?? "localhost";
    const { rows } = await db.query(
      `
      SELECT t.id, t.slug,
             COALESCE((SELECT hostname FROM domains d WHERE d.tenant_id = t.id AND d.is_primary LIMIT 1),
                      t.slug || '.' || $1) AS hostname,
             bp.nap->>'phone_display' AS phone_display,
             bp.nap->>'phone_tel' AS phone_tel
        FROM tenants t JOIN business_profile bp ON bp.tenant_id = t.id
       WHERE t.status = 'live' ORDER BY t.slug`,
      [apex]
    );
    return rows;
  } finally {
    await db.end();
  }
}

function degradeForms(html: string, tenant: TenantRow): string {
  const fallback = `<div style="border:2px solid currentColor;padding:1rem">
    <p><strong>The request form is briefly offline.</strong></p>
    <p>Call us instead: <a href="tel:${tenant.phone_tel}">${tenant.phone_display}</a></p>
  </div>`;
  return html.replace(/<form[\s\S]*?<\/form>/gi, fallback);
}

function semanticChecks(html: string, tenant: TenantRow, path: string): string[] {
  const problems: string[] = [];
  if (!html.includes(tenant.phone_display) && !html.includes(tenant.phone_tel)) {
    problems.push(`canonical phone number missing from ${path}`);
  }
  const jsonLdBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, block] of jsonLdBlocks) {
    try {
      JSON.parse(block);
    } catch {
      problems.push(`JSON-LD does not parse on ${path}`);
    }
  }
  return problems;
}

async function fetchPostSlugs(base: string, host: string): Promise<string[]> {
  const res = await get(base, "/sitemap.xml", host);
  if (res.status !== 200) return [];
  return [...res.body.matchAll(/\/blog\/([a-z0-9-]+)<\/loc>/g)].map((m) => m[1]);
}

async function main() {
  const tenants = await liveTenants();
  let failures = 0;

  for (const tenant of tenants) {
    const base = DIRECT ? `https://${tenant.hostname}` : BASE;
    const paths = [...PAGES, ...(await fetchPostSlugs(base, tenant.hostname)).map((s) => `/blog/${s}`)];
    console.log(`\n=== ${tenant.slug} (${tenant.hostname}) — ${paths.length} pages`);
    for (const path of paths) {
      const res = await get(base, path, tenant.hostname);
      if (res.status !== 200) {
        console.error(`  FAIL ${path}: HTTP ${res.status}`);
        failures++;
        continue;
      }
      // Never snapshot a snapshot: if the edge Worker served this page FROM
      // the failover store (origin was down), writing it back would freeze
      // the stale copy as "fresh". Refuse the whole page instead.
      if (res.headers["x-curbside-failover"]) {
        console.error(`  FAIL ${path}: served BY the failover path — origin is down, aborting this page`);
        failures++;
        continue;
      }
      let html = res.body;
      const problems = semanticChecks(html, tenant, path);
      if (problems.length > 0) {
        console.error(`  FAIL ${path}: ${problems.join("; ")} — snapshot NOT written`);
        failures++;
        continue;
      }
      html = degradeForms(html, tenant);
      const file =
        path === "/" ? "index.html" : `${path.replace(/^\//, "").replace(/\//g, "__")}.html`;
      const dir = join(OUT, tenant.slug);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, file), html, "utf8");
      console.log(`  ok   ${path} → ${file}`);
    }
  }

  console.log(`\nSnapshots written to ${OUT}`);
  if (failures > 0) {
    console.error(`${failures} page(s) failed semantic checks — DO NOT promote this snapshot set.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
