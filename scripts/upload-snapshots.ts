/**
 * Upload static-failover snapshots to Azure Blob Storage (D6, Session 4).
 *
 * Reads what `npm run export:static` wrote to .data/failover-snapshots/<slug>/
 * and uploads each page to the `failover` container KEYED BY HOSTNAME —
 * the edge Worker (infra/cloudflare/worker.js) looks snapshots up by the
 * Host it received, so every hostname that can serve a tenant gets a copy:
 * the platform subdomain plus every verified custom domain.
 *
 * Auth: AZURE_STORAGE_CONNECTION_STRING, or AZURE_STORAGE_ACCOUNT +
 * DefaultAzureCredential (managed identity in the export job, `az login`
 * on a laptop). DB: owner locally, control role in the job.
 *
 * Usage: npm run export:static && npm run snapshots:upload
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { BlobServiceClient } from "@azure/storage-blob";
import { config as dotenv } from "dotenv";
dotenv({ path: [".env.local", ".env"] });

const SNAP_DIR = join(process.cwd(), ".data", "failover-snapshots");
const CONTAINER = "failover";

async function blobContainer() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (conn) return BlobServiceClient.fromConnectionString(conn).getContainerClient(CONTAINER);
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) {
    throw new Error(
      "Set AZURE_STORAGE_ACCOUNT (with az login / managed identity) or " +
        "AZURE_STORAGE_CONNECTION_STRING. Provisioned in RUNBOOK.md Phase 4."
    );
  }
  const { DefaultAzureCredential } = await import("@azure/identity");
  return new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new DefaultAzureCredential()
  ).getContainerClient(CONTAINER);
}

interface Row {
  slug: string;
  hostnames: string[];
}

async function liveTenantHostnames(): Promise<Row[]> {
  const db = new Client({
    connectionString: process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL_CONTROL,
  });
  await db.connect();
  try {
    const apex = process.env.PLATFORM_APEX ?? "localhost";
    const { rows } = await db.query(
      `SELECT t.slug,
              array_remove(array_agg(d.hostname) FILTER (WHERE d.verified_at IS NOT NULL), NULL)
                || ARRAY[t.slug || '.' || $1] AS hostnames
         FROM tenants t LEFT JOIN domains d ON d.tenant_id = t.id
        WHERE t.status = 'live' GROUP BY t.slug ORDER BY t.slug`,
      [apex]
    );
    return rows;
  } finally {
    await db.end();
  }
}

async function main() {
  const tenants = await liveTenantHostnames();
  const container = await blobContainer();
  let uploaded = 0;

  for (const { slug, hostnames } of tenants) {
    const dir = join(SNAP_DIR, slug);
    if (!existsSync(dir)) {
      console.warn(`skip ${slug}: no snapshot dir (run export:static first)`);
      continue;
    }
    const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
    for (const hostname of hostnames) {
      for (const file of files) {
        const blob = container.getBlockBlobClient(`${hostname}/${file}`);
        await blob.uploadData(readFileSync(join(dir, file)), {
          blobHTTPHeaders: {
            blobContentType: "text/html; charset=utf-8",
            // Failover pages must never be cached stale by intermediaries;
            // the Worker adds its own no-store on the way out anyway.
            blobCacheControl: "no-store",
          },
        });
        uploaded++;
      }
      console.log(`  ${slug} → ${hostname}/ (${files.length} pages)`);
    }
  }

  if (uploaded === 0) {
    console.error("Nothing uploaded — no live tenants with snapshots. Run export:static first.");
    process.exit(1);
  }
  console.log(`\n${uploaded} blobs uploaded to '${CONTAINER}'.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
