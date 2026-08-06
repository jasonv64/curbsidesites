/**
 * The origin/edge trust boundary (D23): with TRUST_PROXY_HOST=1, the proxy
 * serves ONLY requests carrying the edge Worker's shared secret — a forged
 * X-Forwarded-Host from anyone else gets 403, never a tenant page. This is
 * the exact attack that worked against the bare Container App FQDN until
 * Session 1 (curl -H 'X-Forwarded-Host: <tenant host>' → 200).
 *
 * Runs the real proxy function with real NextRequests; no server needed.
 * The pass-through case resolves the host against the dev DB like production
 * would, so DATABASE_URL must point at a seeded database (CI does this).
 */
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import proxy from "../src/proxy";

const TENANT_HOST = "iron-ridge-offroad.localhost";
const ORIGIN = "https://curbside-app.internal.example";

function req(headers: Record<string, string>, path = "/"): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, { headers });
}

afterEach(() => {
  delete process.env.TRUST_PROXY_HOST;
  delete process.env.EDGE_SHARED_SECRET;
});

describe("D23 trust boundary", () => {
  it("locked origin: forged X-Forwarded-Host without the edge secret → 403", async () => {
    process.env.TRUST_PROXY_HOST = "1";
    process.env.EDGE_SHARED_SECRET = "test-edge-secret";
    const res = await proxy(req({ host: "aca-fqdn.example", "x-forwarded-host": TENANT_HOST }));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("locked origin: wrong secret → 403", async () => {
    process.env.TRUST_PROXY_HOST = "1";
    process.env.EDGE_SHARED_SECRET = "test-edge-secret";
    const res = await proxy(
      req({ host: "aca-fqdn.example", "x-forwarded-host": TENANT_HOST, "x-curbside-edge": "guess" })
    );
    expect(res.status).toBe(403);
  });

  it("locked origin: the edge Worker's secret → the tenant rewrite", async () => {
    process.env.TRUST_PROXY_HOST = "1";
    process.env.EDGE_SHARED_SECRET = "test-edge-secret";
    const res = await proxy(
      req({
        host: "aca-fqdn.example",
        "x-forwarded-host": TENANT_HOST,
        "x-curbside-edge": "test-edge-secret",
      })
    );
    const rewrite = res.headers.get("x-middleware-rewrite");
    expect(rewrite).toContain(`/s/${encodeURIComponent(TENANT_HOST)}`);
  });

  it("TRUST_PROXY_HOST=1 without EDGE_SHARED_SECRET is half-configured and throws (D11/D23)", async () => {
    process.env.TRUST_PROXY_HOST = "1";
    await expect(proxy(req({ host: "aca-fqdn.example" }))).rejects.toThrow(/EDGE_SHARED_SECRET/);
  });

  it("local mode (no TRUST_PROXY_HOST): X-Forwarded-Host stays meaningless, Host routes", async () => {
    const res = await proxy(
      req({ host: TENANT_HOST, "x-forwarded-host": "attacker-controlled.example" })
    );
    const rewrite = res.headers.get("x-middleware-rewrite");
    expect(rewrite).toContain(`/s/${encodeURIComponent(TENANT_HOST)}`);
    expect(rewrite).not.toContain("attacker-controlled");
  });
});
