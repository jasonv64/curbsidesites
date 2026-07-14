/**
 * Offboarding (Part 9, D20). Gracious by design — in a referral market, how
 * you treat someone on the way out is a marketing channel. The sequence:
 *
 *   1. status = suspended → the dignified under-construction page
 *   2. exit export — the full data handover (the formatted exit REPORT is the
 *      monthly-report artifact, built once in Session 3 / GROWTH Part 5; this
 *      export is its underlying data, complete either way)
 *   3. release the domain — they keep it, ALWAYS + clean handback instructions
 *   4. purge their secrets from the vault (manifest now, automated in S4)
 *   5. delete recording + transcript; retention clock starts on the rest
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { audit, controlOne, controlQuery, revalidateTenant } from "@/lib/control/db";
import { releaseDomains } from "@/lib/control/domains";
import { sendPlatformEmail } from "@/lib/control/notify";

export interface OffboardResult {
  export_dir: string;
  released_domains: string[];
  purge_manifest: string[]; // vault secret names to purge (automated in S4)
  transcripts_deleted: number;
}

export async function offboardTenant(tenantId: string, actor: string): Promise<OffboardResult> {
  const tenant = await controlOne<{ slug: string; business_name: string; owner_email: string | null; status: string }>(
    "SELECT slug, business_name, owner_email, status FROM tenants WHERE id = $1",
    [tenantId]
  );
  if (!tenant) throw new Error("offboardTenant: unknown tenant");

  // 1. Under-construction page, effective next request (tenant row is fresh).
  await controlQuery("UPDATE tenants SET status = 'suspended', updated_at = now() WHERE id = $1", [tenantId]);
  await revalidateTenant(tenant.slug);

  // 2. Exit export: traffic, conversions, leads, reviews, content — theirs.
  const [leads, reviews, events, content, subscribers] = await Promise.all([
    controlQuery("SELECT name, contact, service, vehicle, message, source, status, created_at FROM leads WHERE tenant_id = $1 AND is_demo = false ORDER BY created_at", [tenantId]),
    controlQuery("SELECT source, author, rating, body, published_at FROM reviews WHERE tenant_id = $1 AND is_demo = false ORDER BY published_at", [tenantId]),
    controlQuery("SELECT type, payload, created_at FROM events WHERE tenant_id = $1 ORDER BY created_at", [tenantId]),
    controlQuery("SELECT type, slug, frontmatter, body, published_at FROM content WHERE tenant_id = $1 ORDER BY created_at", [tenantId]),
    controlQuery("SELECT email, created_at FROM subscribers WHERE tenant_id = $1 AND is_demo = false", [tenantId]),
  ]);
  const conversionsByType: Record<string, number> = {};
  for (const e of events) conversionsByType[e.type] = (conversionsByType[e.type] ?? 0) + 1;

  const exportDir = join(process.cwd(), ".data", "exports", tenant.slug);
  await mkdir(exportDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  await writeFile(
    join(exportDir, `${stamp}-exit-export.json`),
    JSON.stringify(
      {
        business: tenant.business_name,
        exported_at: new Date().toISOString(),
        summary: { leads: leads.length, reviews: reviews.length, conversions: conversionsByType, posts: content.length, subscribers: subscribers.length },
        leads,
        reviews,
        content,
        subscribers,
        // Raw events included so the Session-3 report renderer can produce
        // the formatted exit report from this same file (D20: build it once).
        events,
      },
      null,
      2
    ),
    "utf8"
  );
  // Leads also as CSV — the format a shop owner can actually open.
  const csv = [
    "name,email,phone,service,status,source,created_at",
    ...leads.map((l) =>
      [l.name, l.contact?.email ?? "", l.contact?.phone ?? "", l.service ?? "", l.status, l.source, l.created_at]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");
  await writeFile(join(exportDir, `${stamp}-leads.csv`), csv, "utf8");

  // 3. Domains: remove custom hostnames, hand back clean instructions.
  const released = await releaseDomains(tenantId, actor);

  // 4. Secrets: flip integrations to demo, collect the vault purge manifest.
  const integrations = await controlQuery<{ kv_secret_ref: string | null }>(
    "SELECT kv_secret_ref FROM integrations WHERE tenant_id = $1 AND kv_secret_ref IS NOT NULL",
    [tenantId]
  );
  const purgeManifest = integrations.map((i) => i.kv_secret_ref!).filter(Boolean);
  await controlQuery(
    "UPDATE integrations SET mode = 'demo', updated_at = now() WHERE tenant_id = $1",
    [tenantId]
  );

  // 5. Recording + transcript: deleted, not archived (2.2.5 / Part 9.5 —
  //    what the privacy policy says is what actually happens).
  const deleted = await controlQuery<{ id: string }>(
    "DELETE FROM transcripts WHERE tenant_id = $1 RETURNING id",
    [tenantId]
  );

  await audit(actor, tenantId, "tenant.offboarded", {
    released_domains: released,
    purge_manifest: purgeManifest,
    transcripts_deleted: deleted.length,
    export_dir: exportDir,
  });

  if (tenant.owner_email) {
    await sendPlatformEmail({
      to: tenant.owner_email,
      subject: `${tenant.business_name} — your full data export and next steps`,
      text: [
        `We're sorry to see you go, and we mean that. Here's everything, cleanly:`,
        "",
        `• Your domain${released.length === 1 ? "" : "s"} ${released.join(", ") || "(none were connected)"} ${released.length === 1 ? "is" : "are"} yours and always ${released.length === 1 ? "was" : "were"} — we've disconnected our infrastructure, and your registrar settings are back in your hands. If a future provider needs DNS changes, they'll send instructions just like we did.`,
        `• Your complete export — every lead, review, post, subscriber, and conversion — is attached-slash-available on request: leads as a spreadsheet, everything as JSON any developer can import.`,
        `• Your call recording and transcript have been deleted. Remaining account data is removed after the retention window in the privacy policy.`,
        "",
        `If you ever want the site back, everything can be live again in a day. And if a neighbor needs a site — you know where we are.`,
        "",
        `— Curbside Sites`,
      ].join("\n"),
    });
  }

  return {
    export_dir: exportDir,
    released_domains: released,
    purge_manifest: purgeManifest,
    transcripts_deleted: deleted.length,
  };
}
