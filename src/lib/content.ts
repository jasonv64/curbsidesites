/**
 * Content reads/writes (D18). Bodies are MDX-compatible markdown in the
 * content table; frontmatter is typed columns validated by Zod ON WRITE —
 * bad frontmatter can't get into the table through this module.
 */
import { withTenant } from "@/lib/db";
import { frontmatterSchema, slugSchema, type ContentRow, type Frontmatter } from "@/lib/schemas";

export async function listPublishedPosts(tenantId: string): Promise<ContentRow[]> {
  return withTenant(tenantId, (db) =>
    db.query<ContentRow>(
      `SELECT id, type, slug, frontmatter, body, published_at, updated_at
         FROM content
        WHERE type = 'post' AND published_at IS NOT NULL AND published_at <= now()
        ORDER BY (frontmatter->>'date') DESC`
    )
  );
}

export async function getPublishedPost(tenantId: string, slug: string): Promise<ContentRow | null> {
  if (!slugSchema.safeParse(slug).success) return null;
  return withTenant(tenantId, (db) =>
    db.one<ContentRow>(
      `SELECT id, type, slug, frontmatter, body, published_at, updated_at
         FROM content
        WHERE type = 'post' AND slug = $1 AND published_at IS NOT NULL AND published_at <= now()`,
      [slug]
    )
  );
}

/** All posts including drafts — portal only. */
export async function listAllPosts(tenantId: string): Promise<ContentRow[]> {
  return withTenant(tenantId, (db) =>
    db.query<ContentRow>(
      `SELECT id, type, slug, frontmatter, body, published_at, updated_at
         FROM content WHERE type = 'post'
        ORDER BY (frontmatter->>'date') DESC`
    )
  );
}

/** Zod-validated write (D18). Returns field errors instead of throwing. */
export async function upsertPost(
  tenantId: string,
  input: { slug: string; frontmatter: unknown; body: string; publish: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const slug = slugSchema.safeParse(input.slug);
  if (!slug.success) return { ok: false, error: "Slug must be lowercase letters, numbers, and hyphens." };
  const fm = frontmatterSchema.safeParse(input.frontmatter);
  if (!fm.success) {
    return { ok: false, error: fm.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  if (input.body.trim().length < 50) return { ok: false, error: "Post body is too short to publish." };

  await withTenant(tenantId, (db) =>
    db.query(
      `INSERT INTO content (tenant_id, type, slug, frontmatter, body, published_at)
       VALUES ($1, 'post', $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)
       ON CONFLICT (tenant_id, type, slug) DO UPDATE SET
         frontmatter = EXCLUDED.frontmatter,
         body = EXCLUDED.body,
         published_at = CASE
           WHEN $5 THEN COALESCE(content.published_at, now())
           ELSE NULL END,
         updated_at = now()`,
      [tenantId, slug.data, JSON.stringify(fm.data satisfies Frontmatter), input.body, input.publish]
    )
  );
  return { ok: true };
}
