import { readUpload } from "@/lib/blob";
import { getTenantBundle } from "@/lib/tenant";

/**
 * Serves local-dev uploads (lead photos, client images). In production these
 * live in Azure Blob Storage behind next/image remotePatterns (Session 4);
 * this route is the local stand-in. Only THIS tenant's files are reachable
 * from this host — the tenant slug in the path must match the resolved host.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/s/[host]/uploads/[...path]">
) {
  const { host, path } = await ctx.params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return new Response("Not found", { status: 404 });
  if (path.length !== 2 || path[0] !== bundle.tenant.slug) {
    return new Response("Not found", { status: 404 });
  }
  const file = await readUpload(path[0], path[1]);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.body), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "public, max-age=86400" },
  });
}
