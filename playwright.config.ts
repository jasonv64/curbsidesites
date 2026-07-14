import { defineConfig } from "@playwright/test";

/**
 * E2E + accessibility suite. Runs against the PRODUCTION server
 * (`next start`, Part 15) — build first. *.localhost hostnames resolve to
 * loopback in Chromium, which is how the multi-tenant Host routing gets
 * exercised for real.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false, // suites share DB fixtures; keep them ordered
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000/api/status",
    reuseExistingServer: true,
    timeout: 60_000,
    // 401 from /api/status still means "server is up"
    ignoreHTTPSErrors: true,
  },
});
