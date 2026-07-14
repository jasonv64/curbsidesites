import Link from "next/link";
import { controlQuery } from "@/lib/control/db";
import { decidePendingAction, resolveChangeRequestAction } from "../actions";

export const dynamic = "force-dynamic";

const btn = "rounded border border-edge px-3 py-1.5 text-sm font-semibold hover:text-accent";
const inputCls = "rounded border border-edge bg-surface px-3 py-1.5 text-sm";

/**
 * The queue (Parts 4 + 8): actions the automation PREPARED and a human takes,
 * plus change requests the AI couldn't map to a typed diff (or the client
 * marked urgent). The human here is Jason until there's a tech.
 */
export default async function QueuePage() {
  const [actions, crs] = await Promise.all([
    controlQuery<{
      id: string; tenant_id: string | null; kind: string; reason: string; created_at: string; slug: string | null;
    }>(
      `SELECT p.id, p.tenant_id, p.kind, p.reason, p.created_at, t.slug
         FROM pending_actions p LEFT JOIN tenants t ON t.id = p.tenant_id
        WHERE p.status = 'pending' ORDER BY p.created_at`
    ),
    controlQuery<{
      id: string; tenant_id: string; raw_message: string; status: string; urgent: boolean; created_at: string; slug: string;
    }>(
      `SELECT c.id, c.tenant_id, c.raw_message, c.status, c.urgent, c.created_at, t.slug
         FROM change_requests c JOIN tenants t ON t.id = c.tenant_id
        WHERE c.resolved_at IS NULL AND (c.status = 'escalated' OR c.urgent)
        ORDER BY c.urgent DESC, c.created_at`
    ),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="font-display text-3xl">Pending human actions</h1>
        <p className="mb-4 text-sm text-ink-muted">
          The automation prepared these; a person takes them. Suspension approvals live here on
          purpose — a webhook never kills a business&apos;s phone line (Part 4).
        </p>
        {actions.length === 0 && <p className="text-sm text-ink-muted">Nothing pending. Good.</p>}
        <ul className="flex flex-col gap-3">
          {actions.map((a) => (
            <li key={a.id} className="rounded border border-accent p-3">
              <p className="text-sm">
                <strong>{a.kind}</strong>
                {a.slug && (
                  <> · <Link href={`/tenants/${a.slug}`} className="text-accent underline">{a.slug}</Link></>
                )}{" "}
                · {new Date(a.created_at).toISOString().slice(0, 10)}
              </p>
              <p className="mt-1 text-sm">{a.reason}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <form action={decidePendingAction} className="flex items-center gap-2">
                  <input type="hidden" name="action_id" value={a.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button type="submit" className="rounded bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand">
                    {a.kind === "suspend_tenant" ? "Approve suspension (I checked)" : "Approve"}
                  </button>
                </form>
                <form action={decidePendingAction} className="flex items-center gap-2">
                  <input type="hidden" name="action_id" value={a.id} />
                  <input type="hidden" name="decision" value="dismiss" />
                  <input name="note" placeholder="why dismissed" aria-label="Dismissal note" className={inputCls} />
                  <button type="submit" className={btn}>Dismiss</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-display text-2xl">Change-request queue (Part 8)</h2>
        <p className="mb-4 text-sm text-ink-muted">
          Escalations and urgent requests only — typed diffs the client confirmed never touch
          staff. The original message is the audit record.
        </p>
        {crs.length === 0 && <p className="text-sm text-ink-muted">Queue is empty.</p>}
        <ul className="flex flex-col gap-3">
          {crs.map((c) => (
            <li key={c.id} className="rounded border border-edge p-3">
              <p className="text-sm">
                <Link href={`/tenants/${c.slug}`} className="font-semibold text-accent underline">{c.slug}</Link>
                {c.urgent && <span className="ml-2 font-semibold text-accent">URGENT</span>}
                <span className="text-ink-muted"> · {new Date(c.created_at).toLocaleString()}</span>
              </p>
              <blockquote className="mt-1 border-l-2 border-edge pl-3 text-sm">{c.raw_message}</blockquote>
              <form action={resolveChangeRequestAction} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="cr_id" value={c.id} />
                <input type="hidden" name="tenant_id" value={c.tenant_id} />
                <input
                  name="note"
                  placeholder="what was done / quote given (custom work → quote + care-plan bump, D17)"
                  aria-label="Resolution note"
                  className={`${inputCls} min-w-72 flex-1`}
                />
                <button type="submit" className={btn}>Resolve</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
