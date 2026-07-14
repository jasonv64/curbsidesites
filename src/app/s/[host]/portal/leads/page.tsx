import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getPortalSession } from "@/lib/portal-auth";
import { withTenant } from "@/lib/db";
import type { LeadRow } from "@/lib/schemas";
import { updateLeadStatus } from "../actions";

const STATUSES = ["new", "contacted", "quoted", "won", "lost"] as const;

/**
 * Leads inbox. Shows REAL leads; until the first real one exists it shows the
 * seeded samples, clearly labeled — never both in one view (D5).
 */
export default async function LeadsPage({ params }: PageProps<"/s/[host]/portal/leads">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const session = await getPortalSession(bundle);
  if (!session) redirect("/portal");

  const real = await withTenant(bundle.tenant.id, (db) =>
    db.query<LeadRow>(
      `SELECT id, name, contact, service, vehicle, message, photo_urls, source, status, is_demo, created_at
         FROM leads WHERE is_demo = false ORDER BY created_at DESC LIMIT 100`
    )
  );
  const leads =
    real.length > 0
      ? real
      : await withTenant(bundle.tenant.id, (db) =>
          db.query<LeadRow>(
            `SELECT id, name, contact, service, vehicle, message, photo_urls, source, status, is_demo, created_at
               FROM leads WHERE is_demo = true ORDER BY created_at DESC LIMIT 20`
          )
        );
  const showingDemo = real.length === 0 && leads.length > 0;

  return (
    <div>
      <h2 className="font-display text-2xl text-ink">Leads</h2>
      {showingDemo ? (
        <p className="mt-2 border-2 border-edge bg-surface-raised p-3 text-sm text-ink-muted">
          Sample leads — real requests from your website will replace these automatically.
        </p>
      ) : null}
      {leads.length === 0 ? (
        <p className="mt-6 text-ink-muted">No leads yet. They&apos;ll land here the moment the form is used.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {leads.map((lead) => (
            <li key={lead.id} className="border-2 border-edge p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-ink">
                    {lead.name}
                    <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      via {lead.source}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {new Date(lead.created_at).toLocaleString("en-US")}
                    {lead.service ? ` · ${lead.service}` : ""}
                    {lead.vehicle ? ` · ${lead.vehicle}` : ""}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {lead.contact?.phone ? `📞 ${lead.contact.phone} ` : ""}
                    {lead.contact?.email ? `✉ ${lead.contact.email}` : ""}
                    {lead.contact?.preferred ? ` — prefers ${lead.contact.preferred}` : ""}
                  </p>
                </div>
                {!lead.is_demo ? (
                  <form action={updateLeadStatus} className="flex items-center gap-2">
                    <input type="hidden" name="lead_id" value={lead.id} />
                    <label htmlFor={`status-${lead.id}`} className="text-sm font-bold text-ink">
                      Status
                    </label>
                    <select
                      id={`status-${lead.id}`}
                      name="status"
                      defaultValue={lead.status}
                      className="border-2 border-edge bg-surface px-2 py-1.5 text-sm text-ink"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button type="submit" className="border-2 border-edge px-3 py-1.5 text-sm font-bold text-ink hover:border-accent">
                      Save
                    </button>
                  </form>
                ) : (
                  <span className="border-2 border-edge px-2 py-1 text-xs font-bold uppercase text-ink-muted">
                    sample · {lead.status}
                  </span>
                )}
              </div>
              <p className="mt-3 whitespace-pre-line text-ink">{lead.message}</p>
              {lead.photo_urls.length > 0 ? (
                <div className="mt-3 flex gap-2">
                  {lead.photo_urls.map((url) => (
                    <Image
                      key={url}
                      src={url}
                      alt={`Photo attached by ${lead.name}`}
                      width={96}
                      height={96}
                      className="h-24 w-24 border-2 border-edge object-cover"
                    />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
