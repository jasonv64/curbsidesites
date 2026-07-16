/**
 * Upload storage. Local dev: filesystem under UPLOAD_DIR, served by the
 * /uploads/[...path] route handler. Production: Azure Blob Storage — set
 * AZURE_STORAGE_ACCOUNT (managed identity / DefaultAzureCredential) or
 * AZURE_STORAGE_CONNECTION_STRING and uploads land in the public
 * `tenant-images` container, matching next.config.ts remotePatterns.
 * Callers only ever see saveUpload(). Provisioned by RUNBOOK.md Phase 4.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

const AZURE_CONTAINER = "tenant-images";
let azureContainerClient: import("@azure/storage-blob").ContainerClient | null = null;

function azureConfigured(): boolean {
  return Boolean(process.env.AZURE_STORAGE_ACCOUNT || process.env.AZURE_STORAGE_CONNECTION_STRING);
}

async function azureContainer() {
  if (azureContainerClient) return azureContainerClient;
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  let svc;
  if (conn) {
    svc = BlobServiceClient.fromConnectionString(conn);
  } else {
    const { DefaultAzureCredential } = await import("@azure/identity");
    svc = new BlobServiceClient(
      `https://${process.env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`,
      new DefaultAzureCredential()
    );
  }
  azureContainerClient = svc.getContainerClient(AZURE_CONTAINER);
  return azureContainerClient;
}

// Statically scoped under cwd so the build tracer doesn't pull the world in.
const uploadRoot = () => {
  const dir = process.env.UPLOAD_DIR ?? ".data/uploads";
  return isAbsolute(dir) ? dir : join(process.cwd(), dir);
};

const SAFE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function saveUpload(
  tenantSlug: string,
  file: File
): Promise<{ publicPath: string } | { error: string }> {
  const ext = SAFE_EXT[file.type];
  if (!ext) return { error: "Only JPEG, PNG, or WebP images are accepted." };
  if (file.size > 10 * 1024 * 1024) return { error: "Images must be under 10 MB." };
  const name = `${randomUUID()}.${ext}`;
  if (azureConfigured()) {
    try {
      const container = await azureContainer();
      const blob = container.getBlockBlobClient(`${tenantSlug}/${name}`);
      await blob.uploadData(Buffer.from(await file.arrayBuffer()), {
        blobHTTPHeaders: {
          blobContentType: file.type,
          // Blob names are UUIDs — safe to cache forever.
          blobCacheControl: "public, max-age=31536000, immutable",
        },
      });
      return { publicPath: blob.url };
    } catch (e) {
      console.error(`[blob] Azure upload failed for ${tenantSlug}: ${(e as Error).message}`);
      return { error: "Image upload is briefly unavailable — try again in a minute." };
    }
  }
  const dir = join(uploadRoot(), tenantSlug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));
  return { publicPath: `/uploads/${tenantSlug}/${name}` };
}

/** Read back for the serving route. Path-traversal-safe. */
export async function readUpload(
  tenantSlug: string,
  filename: string
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!/^[a-z0-9-]+$/.test(tenantSlug) || !/^[a-zA-Z0-9-]+\.(jpg|png|webp)$/.test(filename)) {
    return null;
  }
  const path = normalize(join(uploadRoot(), tenantSlug, filename));
  try {
    const body = await readFile(path);
    const ct =
      filename.endsWith(".png") ? "image/png" :
      filename.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return { body, contentType: ct };
  } catch {
    return null;
  }
}
