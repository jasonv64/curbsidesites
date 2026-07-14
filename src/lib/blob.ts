/**
 * Upload storage. Local dev: filesystem under UPLOAD_DIR, served by the
 * /uploads/[...path] route handler. Production: Azure Blob Storage
 * (Session 4 — swap the provider below; callers only see saveUpload()).
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

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
