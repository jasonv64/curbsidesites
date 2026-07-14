import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { controlOne, controlQuery } from "@/lib/control/db";
import { secretPopulated } from "@/lib/secrets";
import { contrastReport } from "@/lib/brand";
import type { BrandTokens } from "@/lib/schemas";
import {
  approveBrandAction,
  markCallHeldAction,
  offboardAction,
  publishPostAction,
  recordVerbalConsentAction,
  rejectBrandAction,
  restoreAction,
  suspendAction,
  withdrawConsentAction,
} from "../../actions";
import { GoLivePanel, ProvisionDomainPanel, SeedContentPanel, TranscriptPanel } from "./panels";

export const dynamic = "force-dynamic";

const btn = "rounded border border-edge px-3 py-1.5 text-sm font-semibold hover:text-accent";
const inputCls = "rounded border border-edge bg-surface px-3 py-1.5 text-sm";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-edge p-4">
      <h2 className="mb-3 font-display text-xl">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default async function TenantDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await controlOne<{
    id: string; slug: string; business_name: string; status: string; plan_tier: string;
    features: Record<string, boolean>; owner_email: string | null; preview_token: string; created_at: string;
  }>("SELECT * FROM tenants WHERE slug = $1", [slug]);
  if (!tenant) notFound();

  const [proposal, consents, calls, transcripts, drafts, domains, integrations, billing, failures, actionsPending, auditRows] =
    await Promise.all([
      controlOne<{ id: string; tokens: BrandTokens; font_pairing_key: string; status: string; notes: { source?: string; texture_notes?: string; do_not_do?: string[] }; decision_note: string | null }>(
        "SELECT id, tokens, font_pairing_key, status, notes, decision_note FROM brand_proposals WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
        [tenant.id]
      ),
      controlQuery("SELECT id, kind, source, granted_at, withdrawn_at FROM consents WHERE tenant_id = $1 ORDER BY granted_at", [tenant.id]),
      controlQuery("SELECT id, scheduled_at, held_at, recorded, notes FROM onboarding_calls WHERE tenant_id = $1 ORDER BY scheduled_at DESC", [tenant.id]),
      controlQuery("SELECT id, verbal_consent, created_at, length(body)::int AS chars FROM transcripts WHERE tenant_id = $1 ORDER BY created_at DESC", [tenant.id]),
      controlQuery("SELECT id, slug, frontmatter, published_at FROM content WHERE tenant_id = $1 AND type = 'post' ORDER BY created_at DESC", [tenant.id]),
      controlQuery("SELECT id, hostname, registrar, verification_status, verified_at, instructions_sent_at, last_chased_at FROM domains WHERE tenant_id = $1", [tenant.id]),
      controlQuery<{
        key: string; mode: string; config: Record<string, string>; kv_secret_ref: string | null;
        key_owner: string; last_error_at: string | null; last_error: string | null; secret_expires_at: string | null;
      }>("SELECT key, mode, config, kv_secret_ref, key_owner, last_error_at, last_error, secret_expires_at FROM integrations WHERE tenant_id = $1 ORDER BY key", [tenant.id]),
      controlOne("SELECT * FROM billing WHERE tenant_id = $1", [tenant.id]),
      controlQuery("SELECT id, amount_cents, first_failed_at, retries, warnings, status FROM payment_failures WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 3", [tenant.id]),
      controlQuery("SELECT id, kind, reason, status, created_at FROM pending_actions WHERE tenant_id = $1 AND status = 'pending'", [tenant.id]),
      controlQuery("SELECT actor, action, detail, created_at FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 12", [tenant.id]),
    ]);

  const integrationsWithSecrets = await Promise.all(
    integrations.map(async (i) => ({ ...i, secret_ok: await secretPopulated(i.kv_secret_ref) }))
  );

  const h = await headers();
  const adminHost = h.get("host") ?? "admin.localhost:3000";
  const tenantHost = adminHost.replace(/^admin\./, `${tenant.slug}.`);
  const proto = adminHost.includes("localhost") || adminHost.includes(".test") ? "http" : "https";
  const previewUrl = `${proto}://${tenantHost}/?preview=${tenant.preview_token}`;
  const liveUrl = `${proto}://${tenantHost}/`;

  const report = proposal ? contrastReport(proposal.tokens) : [];
  const activeRecordingConsent = consents.some((c) => c.kind === "call_recording_ai" && !c.withdrawn_at);
  const unpublished = drafts.filter((d) => !d.published_at);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{tenant.business_name}</h1>
          <p className="text-sm text-ink-muted">
            {tenant.slug} · {tenant.status} · {tenant.plan_tier} · owner {tenant.owner_email ?? "—"}
          </p>
          <p className="mt-1 text-sm">
            <a href={tenant.status === "draft" ? previewUrl : liveUrl} className="font-semibold text-accent underline">
              {tenant.status === "draft" ? "Open draft preview" : "Open site"} →
            </a>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tenant.status === "live" && (
            <form action={suspendAction}>
              <input type="hidden" name="tenant_id" value={tenant.id} />
              <input type="hidden" name="reason" value="manual staff suspension from tenant page" />
              <button type="submit" className={btn}>Suspend</button>
            </form>
          )}
          {tenant.status === "suspended" && (
            <form action={restoreAction}>
              <input type="hidden" name="tenant_id" value={tenant.id} />
              <button type="submit" className={btn}>Restore</button>
            </form>
          )}
        </div>
      </div>

      {actionsPending.length > 0 && (
        <div className="rounded border border-accent p-3 text-sm">
          <p className="font-semibold">Pending human actions:</p>
          {actionsPending.map((a) => (
            <p key={a.id}>
              {a.kind} — {a.reason} (<Link href="/queue" className="text-accent underline">decide in the queue</Link>)
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Brand gate (2.3)">
          {!proposal ? (
            <p className="text-sm text-ink-muted">No proposal yet.</p>
          ) : (
            <>
              <p className="text-sm">
                Status: <strong>{proposal.status}</strong> · pairing <code>{proposal.font_pairing_key}</code>
                {proposal.decision_note ? ` · note: ${proposal.decision_note}` : ""}
              </p>
              <p className="text-xs text-ink-muted">Source: {proposal.notes?.source}</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(proposal.tokens).map(([name, hex]) => (
                  <span key={name} className="flex items-center gap-1 rounded border border-edge px-1.5 py-0.5 text-xs">
                    <span className="inline-block h-4 w-4 rounded border border-edge" style={{ background: hex }} />
                    {name} {hex}
                  </span>
                ))}
              </div>
              <p className="text-sm">
                Contrast: {report.every((c) => c.pass)
                  ? "all pairs pass AA ✓"
                  : `FAILING: ${report.filter((c) => !c.pass).map((c) => c.pair).join(", ")}`}
              </p>
              {proposal.notes?.texture_notes && (
                <p className="text-sm text-ink-muted">{proposal.notes.texture_notes}</p>
              )}
              {(proposal.notes?.do_not_do?.length ?? 0) > 0 && (
                <ul className="list-disc pl-5 text-sm text-ink-muted">
                  {proposal.notes!.do_not_do!.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              )}
              {proposal.status === "proposed" && (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={approveBrandAction} className="flex items-center gap-2">
                    <input type="hidden" name="proposal_id" value={proposal.id} />
                    <input name="note" placeholder="decision note (optional)" aria-label="Approval note" className={inputCls} />
                    <button type="submit" className="rounded bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand">
                      Approve — I looked at it
                    </button>
                  </form>
                  <form action={rejectBrandAction} className="flex items-center gap-2">
                    <input type="hidden" name="proposal_id" value={proposal.id} />
                    <input name="note" placeholder="why (required for reject)" aria-label="Rejection note" className={inputCls} />
                    <button type="submit" className={btn}>Reject</button>
                  </form>
                </div>
              )}
              <p className="text-xs text-ink-muted">
                Approval writes these tokens to the live brand row. This is the one gate that is
                never automated — look at the preview with these tokens before approving.
              </p>
            </>
          )}
        </Section>

        <Section title="Lifecycle">
          {tenant.status === "draft" ? (
            <GoLivePanel tenantId={tenant.id} />
          ) : (
            <p className="text-sm text-ink-muted">Tenant is {tenant.status}.</p>
          )}
          <details className="rounded border border-edge p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-accent">Offboard (D20 — the full Part 9 sequence)</summary>
            <p className="mt-2 text-ink-muted">
              Suspends the site, writes the exit export (.data/exports/{tenant.slug}/), releases
              domains with handback instructions, flips integrations to demo + emits the vault
              purge manifest, and deletes recordings/transcripts. Type the slug to confirm.
            </p>
            <form action={offboardAction} className="mt-2 flex items-center gap-2">
              <input type="hidden" name="tenant_id" value={tenant.id} />
              <input type="hidden" name="expected_slug" value={tenant.slug} />
              <input name="confirm_slug" placeholder={tenant.slug} aria-label="Type the slug to confirm offboarding" className={inputCls} />
              <button type="submit" className={btn}>Offboard</button>
            </form>
          </details>
        </Section>

        <Section title="Consent (2.2)">
          {consents.length === 0 && <p className="text-sm text-ink-muted">No consent rows.</p>}
          <ul className="text-sm">
            {consents.map((c) => (
              <li key={c.id}>
                <strong>{c.kind}</strong> via {c.source} — granted{" "}
                {new Date(c.granted_at).toISOString().slice(0, 10)}
                {c.withdrawn_at ? ` · WITHDRAWN ${new Date(c.withdrawn_at).toISOString().slice(0, 10)}` : " · active"}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {!activeRecordingConsent && (
              <form action={recordVerbalConsentAction}>
                <input type="hidden" name="tenant_id" value={tenant.id} />
                <button type="submit" className={btn} title="Only after consent was actually captured in the recording">
                  Record verbal consent (captured on call)
                </button>
              </form>
            )}
            {activeRecordingConsent && (
              <form action={withdrawConsentAction}>
                <input type="hidden" name="tenant_id" value={tenant.id} />
                <button type="submit" className={btn}>
                  Withdraw consent (deletes recording + transcript)
                </button>
              </form>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            No active written consent → calls proceed UNRECORDED, notes only. A missing transcript
            is an inconvenience; an unlawful recording is an existential problem (2.2.3).
          </p>
        </Section>

        <Section title="Onboarding call (2.4) & transcript">
          {calls.length === 0 && <p className="text-sm text-ink-muted">No call scheduled.</p>}
          {calls.map((c) => (
            <div key={c.id} className="rounded border border-edge p-2 text-sm">
              <p>
                {new Date(c.scheduled_at).toLocaleString()} —{" "}
                {c.held_at ? `held${c.recorded ? ", recorded" : ", unrecorded"}` : "scheduled"}
              </p>
              {c.notes && <p className="text-ink-muted">{c.notes}</p>}
              {!c.held_at && (
                <form action={markCallHeldAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="call_id" value={c.id} />
                  <input type="hidden" name="tenant_id" value={tenant.id} />
                  <input name="notes" placeholder="call notes" aria-label="Call notes" className={inputCls} />
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name="recorded" disabled={!activeRecordingConsent} />
                    recorded {activeRecordingConsent ? "" : "(blocked: no written consent)"}
                  </label>
                  <button type="submit" className={btn}>Mark held</button>
                </form>
              )}
            </div>
          ))}
          {transcripts.map((t) => (
            <p key={t.id} className="text-sm">
              Transcript {new Date(t.created_at).toISOString().slice(0, 10)} · {t.chars} chars ·
              verbal consent {t.verbal_consent ? "✓" : "✗ (unusable)"}
            </p>
          ))}
          <TranscriptPanel tenantId={tenant.id} callId={calls.find((c) => !c.held_at)?.id ?? calls[0]?.id} />
        </Section>

        <Section title="Content seeding (2.6)">
          <SeedContentPanel tenantId={tenant.id} />
          {unpublished.length > 0 && (
            <>
              <p className="text-sm font-semibold">Drafts awaiting review:</p>
              <ul className="flex flex-col gap-1 text-sm">
                {unpublished.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span>{d.frontmatter?.title ?? d.slug}</span>
                    <a href={`${previewUrl.split("?")[0]}blog/${d.slug}?preview=${tenant.preview_token}`} className="text-accent underline">read</a>
                    <form action={publishPostAction}>
                      <input type="hidden" name="tenant_id" value={tenant.id} />
                      <input type="hidden" name="content_id" value={d.id} />
                      <button type="submit" className={btn}>Publish</button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          )}
          {drafts.filter((d) => d.published_at).length > 0 && (
            <p className="text-xs text-ink-muted">
              Published: {drafts.filter((d) => d.published_at).map((d) => d.slug).join(", ")}
            </p>
          )}
        </Section>

        <Section title="Domains (2.5, D8)">
          {domains.length === 0 && <p className="text-sm text-ink-muted">No client domain on file (platform subdomain serves).</p>}
          <ul className="flex flex-col gap-1 text-sm">
            {domains.map((d) => (
              <li key={d.id}>
                <strong>{d.hostname}</strong> · {d.verification_status}
                {d.registrar ? ` · registrar: ${d.registrar}` : ""}
                {d.instructions_sent_at ? ` · instructions ${new Date(d.instructions_sent_at).toISOString().slice(0, 10)}` : ""}
                {d.last_chased_at ? ` · chased ${new Date(d.last_chased_at).toISOString().slice(0, 10)}` : ""}
              </li>
            ))}
          </ul>
          <ProvisionDomainPanel
            tenantId={tenant.id}
            suggested={domains.find((d) => d.verification_status === "unmanaged")?.hostname}
          />
          <p className="text-xs text-ink-muted">
            Verification polls on every jobs run; clients get chased automatically after 3 quiet
            days. When it verifies AND the brand gate has passed, the tenant flips live on its own.
          </p>
        </Section>

        <Section title="Integrations & secrets (Part 3, D11)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-ink-muted">
                <tr><th className="pr-2">key</th><th className="pr-2">mode</th><th className="pr-2">owner</th><th className="pr-2">secret</th><th className="pr-2">expires</th><th>last error</th></tr>
              </thead>
              <tbody>
                {integrationsWithSecrets.map((i) => (
                  <tr key={i.key} className="border-t border-edge">
                    <td className="pr-2 font-mono text-xs">{i.key}</td>
                    <td className="pr-2">{i.mode}</td>
                    <td className="pr-2">{i.key_owner}</td>
                    <td className="pr-2" title={i.kv_secret_ref ?? ""}>{i.secret_ok ? "populated ✓" : "not populated"}</td>
                    <td className="pr-2">{i.secret_expires_at ? new Date(i.secret_expires_at).toISOString().slice(0, 10) : "—"}</td>
                    <td className="text-xs text-ink-muted" title={i.last_error ?? ""}>
                      {i.last_error_at ? new Date(i.last_error_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-muted">
            Secret NAMES only — values live in the vault and nothing here ever renders one
            (Invariant 3). Flip modes / set config via the go-live runbook in the README;
            /api/status is the fleet-wide checklist.
          </p>
        </Section>

        <Section title="Billing (Part 4)">
          <p className="text-sm">
            Status: <strong>{billing?.status ?? "none"}</strong> · MRR ${((billing?.mrr_cents ?? 0) / 100).toLocaleString()}
            {billing?.stripe_customer_id ? ` · ${billing.stripe_customer_id}` : " · no Stripe customer linked"}
          </p>
          {failures.length > 0 && (
            <ul className="text-sm">
              {failures.map((f) => (
                <li key={f.id}>
                  ${(f.amount_cents / 100).toFixed(2)} failed since {new Date(f.first_failed_at).toISOString().slice(0, 10)} ·
                  retries {f.retries} · warnings {(f.warnings ?? []).map((w: { day: number }) => `d${w.day}`).join(",") || "none"} ·
                  <strong> {f.status}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-muted">
            Suspension is never automatic: dunning prepares a pending action after day 14; a human
            approves it in the queue. Simulate locally: npm run stripe:simulate — see README.
          </p>
        </Section>
      </div>

      <Section title="Recent audit trail">
        <ul className="text-xs text-ink-muted">
          {auditRows.map((a, i) => (
            <li key={i}>
              {new Date(a.created_at).toISOString().slice(0, 16).replace("T", " ")} · {a.actor} · {a.action}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
