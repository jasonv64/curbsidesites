/**
 * Live Instagram: read path over cached rows + the fetch job that fills them.
 * The job (scripts/fetch-instagram.ts, scheduled in Session 3) calls the
 * Instagram Graph API with the tenant's access token and writes image rows
 * with purpose='instagram'. Pages read only our rows (D10).
 */
import { withTenant } from "@/lib/db";
import type { TenantBundle } from "@/lib/tenant";
import type { InstagramFeed, InstaPost } from "./types";

export async function liveInstagram(bundle: TenantBundle): Promise<InstagramFeed> {
  const rows = await withTenant(bundle.tenant.id, (db) =>
    db.query(
      `SELECT slot_id, alt, url, credit FROM images
        WHERE purpose = 'instagram' AND url IS NOT NULL
        ORDER BY slot_id LIMIT 8`
    )
  );
  const posts: InstaPost[] = rows.map((r) => ({
    id: r.slot_id,
    caption: r.alt,
    imageUrl: r.url,
    permalink: r.credit, // fetch job stores the post permalink in credit
  }));
  if (posts.length === 0) {
    throw new Error("instagram live selected but no cached posts exist — run scripts/fetch-instagram.ts");
  }
  return { posts, handle: bundle.profile?.socials?.instagram ?? null, isDemo: false };
}

/** Job-side fetcher. Writes cached rows; never called from a request. */
export async function fetchInstagramPosts(opts: {
  tenantId: string;
  accessToken: string;
}): Promise<{ fetched: number }> {
  const res = await fetch(
    `https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,permalink&limit=8&access_token=${encodeURIComponent(opts.accessToken)}`
  );
  if (!res.ok) throw new Error(`Instagram Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    data?: { id: string; caption?: string; media_type: string; media_url: string; permalink: string }[];
  };
  const posts = (data.data ?? []).filter((p) => p.media_type !== "VIDEO").slice(0, 8);
  await withTenant(opts.tenantId, async (db) => {
    await db.query("DELETE FROM images WHERE tenant_id = $1 AND purpose = 'instagram'", [opts.tenantId]);
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      await db.query(
        `INSERT INTO images (tenant_id, slot_id, purpose, aspect, alt, url, credit)
         VALUES ($1, $2, 'instagram', '1:1', $3, $4, $5)
         ON CONFLICT (tenant_id, slot_id) DO UPDATE SET alt = $3, url = $4, credit = $5`,
        [opts.tenantId, `instagram-${i + 1}`, (p.caption ?? "").slice(0, 300), p.media_url, p.permalink]
      );
    }
  });
  return { fetched: posts.length };
}
