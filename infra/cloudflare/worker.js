/**
 * Curbside edge router — a Cloudflare Worker on the zone-wide catch-all route
 * of the curbsidesites.com zone (RUNBOOK.md Phase 6). The literal route
 * pattern lives in wrangler.toml and is deliberately NOT written out here:
 * it contains the two characters that close a block comment, so spelling it
 * in this header is a build error (`Unexpected "*"`), not a style nit.
 *
 * That catch-all route takes ALL traffic entering the zone, including
 * Cloudflare-for-SaaS custom hostnames (client-owned domains), so this one
 * Worker fronts every tenant site, the platform subdomains, and the admin.
 *
 * Two jobs:
 *
 *  1. ROUTE. Azure Container Apps ingress routes by its own FQDN, so the
 *     request is re-addressed to ORIGIN_HOST and the visitor's real hostname
 *     travels in X-Forwarded-Host. The app reconstructs tenancy from it
 *     (src/proxy.ts, TRUST_PROXY_HOST=1).
 *
 *  2. FAIL OVER (D6). If the origin is unreachable, times out, or 5xxes on a
 *     GET/HEAD, serve that hostname's static snapshot from Blob Storage
 *     (uploaded by scripts/upload-snapshots.ts, keyed by hostname) and email
 *     staff immediately — a silent failover lasting a week is a site we
 *     believe is live and isn't. Failover responses carry
 *     `X-Curbside-Failover: 1`; the export job refuses to re-snapshot them.
 *
 * Vars (wrangler.toml):
 *   ORIGIN_HOST   — the Container App FQDN (curbside-app.<env>.westus3.azurecontainerapps.io)
 *   SNAPSHOT_HOST — <storage-account>.blob.core.windows.net
 *   ALERT_EMAIL   — where failover alerts go (optional; skipped if unset)
 *   ALERT_FROM    — verified Resend sender, e.g. alerts@curbsidesites.com
 * Secrets (wrangler secret put):
 *   RESEND_API_KEY — for failover alert email (optional)
 */

const ORIGIN_TIMEOUT_MS = 20_000;
const ALERT_DEDUPE_SECONDS = 900; // one alert per hostname per 15 min

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const visitorHost = url.hostname;

    // Non-site hosts (www, and anything else added to REDIRECT_HOSTS) fold
    // into the canonical marketing host before any origin work. 301, because
    // this mapping is permanent and one canonical host is what search engines
    // should index; the path carries over so deep links survive.
    const redirectHosts = (env.REDIRECT_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (env.CANONICAL_HOST && redirectHosts.includes(visitorHost.toLowerCase())) {
      return Response.redirect(
        `https://${env.CANONICAL_HOST}${url.pathname}${url.search}`,
        301
      );
    }

    const originUrl = `https://${env.ORIGIN_HOST}${url.pathname}${url.search}`;
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", visitorHost);
    headers.set("X-Forwarded-Proto", "https");

    let originResponse = null;
    try {
      originResponse = await fetch(originUrl, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
        signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
      });
    } catch {
      originResponse = null; // unreachable or timed out
    }

    // A 404 counts as suspect, not healthy. Azure Container Apps answers 404 —
    // NOT 503 — when no revision is active, which is what "the app is down"
    // actually looks like here; the Phase 7.2 drill deactivated the revision
    // and this Worker forwarded the 404 as if the origin were fine. But 404 is
    // also the correct answer for an unknown tenant, so the two cannot be told
    // apart by status alone. The snapshot IS the disambiguator: only LIVE
    // tenants are ever exported (scripts/export-static.ts), so a 404 for a
    // hostname+path we hold a snapshot of means the origin is broken, while a
    // genuinely unknown host has nothing to serve and falls through to the
    // clean 404 below.
    const suspect =
      !originResponse || originResponse.status >= 500 || originResponse.status === 404;
    const canFailover = request.method === "GET" || request.method === "HEAD";
    if (!suspect || !canFailover) {
      return (
        originResponse ??
        new Response("Origin unavailable", { status: 502, headers: { "content-type": "text/plain" } })
      );
    }

    const snapshot = await fetchSnapshot(env, visitorHost, url.pathname);
    if (!snapshot) {
      // No snapshot for this host/path (e.g. admin, or a never-exported page):
      // pass the origin's answer through rather than inventing one.
      return (
        originResponse ??
        new Response("Origin unavailable", { status: 502, headers: { "content-type": "text/plain" } })
      );
    }

    ctx.waitUntil(alertFailover(env, visitorHost, url.pathname, originResponse?.status ?? "unreachable"));
    return snapshot;
  },
};

/** Map a request path to its snapshot blob: "/" → index.html, "/blog/x" → blog__x.html. */
function snapshotFile(pathname) {
  if (pathname === "/" || pathname === "") return "index.html";
  return pathname.replace(/^\//, "").replace(/\//g, "__").replace(/\.html$/, "") + ".html";
}

async function fetchSnapshot(env, host, pathname) {
  const blobUrl = `https://${env.SNAPSHOT_HOST}/failover/${host}/${snapshotFile(pathname)}`;
  try {
    const res = await fetch(blobUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return new Response(res.body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-curbside-failover": "1",
      },
    });
  } catch {
    return null;
  }
}

/**
 * Email staff about the failover, deduped per hostname via the edge cache.
 * The app (and therefore its alerts dashboard) is down — this path must not
 * depend on the origin. Degrades to a console log without a Resend key.
 */
async function alertFailover(env, host, pathname, originStatus) {
  try {
    const cache = caches.default;
    const dedupeKey = new Request(`https://curbside-failover-alert.internal/${host}`);
    if (await cache.match(dedupeKey)) return;
    await cache.put(
      dedupeKey,
      new Response("sent", { headers: { "cache-control": `max-age=${ALERT_DEDUPE_SECONDS}` } })
    );

    console.log(`FAILOVER serving snapshot: host=${host} path=${pathname} origin=${originStatus}`);
    if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.ALERT_FROM ?? "Curbside Edge <alerts@curbsidesites.com>",
        to: [env.ALERT_EMAIL],
        subject: `FAILOVER: ${host} is serving its static snapshot`,
        text:
          `The origin answered "${originStatus}" for https://${host}${pathname} and the edge is now ` +
          `serving the static snapshot (D6).\n\n` +
          `Check the Container App first: az containerapp revision list ...\n` +
          `Rollback (one action): see RUNBOOK.md Phase 11.\n\n` +
          `This alert is deduped per hostname for ${ALERT_DEDUPE_SECONDS / 60} minutes.`,
      }),
    });
  } catch (e) {
    console.log(`failover alert failed: ${e}`);
  }
}
