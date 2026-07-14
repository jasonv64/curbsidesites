"use server";

/**
 * Staff server actions — every state change the control plane can make.
 * Each one: (1) requires a full MFA'd staff session, (2) audits with the
 * staff email as actor. Actions that can refuse (consent, go-live gates)
 * return a message instead of throwing, so the refusal is READ, not buried
 * in a log.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff, type StaffSession } from "@/lib/control/staff-auth";
import { audit, controlOne, controlQuery, revalidateTenant } from "@/lib/control/db";
import { maybeGoLive, provisionDomain } from "@/lib/control/domains";
import { approveSuspension } from "@/lib/control/billing";
import { ConsentError, seedContent, publishPost } from "@/lib/control/content-seeding";
import { offboardTenant } from "@/lib/control/offboarding";
import { runAllJobs } from "@/lib/control/jobs";
import { RECORDING_CONSENT_TEXT } from "@/lib/control/intake-schema";

// NOTE: "use server" modules may only export async functions — shared shapes
// live here as types only; client components inline the idle state.
export interface ActionState {
  status: "idle" | "ok" | "error";
  message: string;
}

async function staff(): Promise<StaffSession> {
  const s = await requireStaff();
  if (!s) redirect("/login");
  return s;
}

/**
 * Every mutation ends here so the admin page the operator is LOOKING AT
 * re-renders with fresh data in the action response (without this, dynamic
 * admin pages keep their stale RSC payload after a plain form action).
 */
function refreshAdmin(): void {
  revalidatePath("/admin", "layout");
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

// ---------------------------------------------------------------------------
// Brand gate (2.3) — the one gate a human always takes
// ---------------------------------------------------------------------------

export async function approveBrandAction(formData: FormData): Promise<void> {
  const s = await staff();
  const proposalId = str(formData, "proposal_id");
  const proposal = await controlOne<{ tenant_id: string; tokens: unknown; font_pairing_key: string }>(
    "SELECT tenant_id, tokens, font_pairing_key FROM brand_proposals WHERE id = $1 AND status = 'proposed'",
    [proposalId]
  );
  if (!proposal) return;
  await controlQuery(
    `UPDATE brand_proposals SET status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`,
    [proposalId, s.id, str(formData, "note") || null]
  );
  await controlQuery(
    `UPDATE brand SET tokens = $2, font_pairing_key = $3, updated_at = now() WHERE tenant_id = $1`,
    [proposal.tenant_id, JSON.stringify(proposal.tokens), proposal.font_pairing_key]
  );
  const t = await controlOne<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [proposal.tenant_id]);
  if (t) await revalidateTenant(t.slug);
  await audit(s.email, proposal.tenant_id, "brand.approved", { proposal_id: proposalId });
  // A verified domain may already be waiting on this gate (2.5).
  await maybeGoLive(proposal.tenant_id, s.email);
  refreshAdmin();
}

export async function rejectBrandAction(formData: FormData): Promise<void> {
  const s = await staff();
  const proposalId = str(formData, "proposal_id");
  const row = await controlOne<{ tenant_id: string }>(
    `UPDATE brand_proposals SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3
      WHERE id = $1 AND status = 'proposed' RETURNING tenant_id`,
    [proposalId, s.id, str(formData, "note") || "rejected"]
  );
  if (row) await audit(s.email, row.tenant_id, "brand.rejected", { proposal_id: proposalId });
  refreshAdmin();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function goLiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  const force = formData.get("force") === "on";
  const result = await maybeGoLive(tenantId, s.email, { force });
  refreshAdmin();
  return result.went_live
    ? { status: "ok", message: "Tenant is LIVE." }
    : { status: "error", message: `Not flipped: ${result.blocked_on}` };
}

export async function suspendAction(formData: FormData): Promise<void> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  const reason = str(formData, "reason") || "manual staff suspension";
  const t = await controlOne<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [tenantId]);
  await controlQuery("UPDATE tenants SET status = 'suspended', updated_at = now() WHERE id = $1", [tenantId]);
  if (t) await revalidateTenant(t.slug);
  await audit(s.email, tenantId, "tenant.suspended", { reason, via: "manual" });
  refreshAdmin();
}

export async function restoreAction(formData: FormData): Promise<void> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  const t = await controlOne<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [tenantId]);
  await controlQuery(
    "UPDATE tenants SET status = 'live', updated_at = now() WHERE id = $1 AND status = 'suspended'",
    [tenantId]
  );
  await controlQuery(
    `UPDATE pending_actions SET status = 'dismissed', decided_by = $2, decided_at = now(), note = 'tenant restored'
      WHERE tenant_id = $1 AND kind = 'suspend_tenant' AND status = 'pending'`,
    [tenantId, s.id]
  );
  if (t) await revalidateTenant(t.slug);
  await audit(s.email, tenantId, "tenant.restored", {});
  refreshAdmin();
}

export async function offboardAction(formData: FormData): Promise<void> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  if (str(formData, "confirm_slug") !== str(formData, "expected_slug")) return; // type-the-slug confirm
  await offboardTenant(tenantId, s.email);
  refreshAdmin();
}

// ---------------------------------------------------------------------------
// Domains (2.5)
// ---------------------------------------------------------------------------

export async function provisionDomainAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  const hostname = str(formData, "hostname").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname)) {
    return { status: "error", message: "Enter a bare domain like shopname.com" };
  }
  try {
    await provisionDomain(tenantId, hostname, s.email);
    refreshAdmin();
    return { status: "ok", message: `Custom hostname created; registrar instructions emailed. Verification polls automatically.` };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "provisioning failed" };
  }
}

// ---------------------------------------------------------------------------
// Consent + call + transcript (2.2 — exactly as written)
// ---------------------------------------------------------------------------

export async function recordVerbalConsentAction(formData: FormData): Promise<void> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  await controlQuery(
    `INSERT INTO consents (tenant_id, kind, source, consent_text, recorded_by)
     VALUES ($1, 'call_recording_ai', 'verbal_on_call', $2, $3)`,
    [
      tenantId,
      "Verbal consent captured at the top of the recorded onboarding call, per the intake consent language: " +
        RECORDING_CONSENT_TEXT,
      s.id,
    ]
  );
  await audit(s.email, tenantId, "consent.verbal_recorded", {});
  refreshAdmin();
}

export async function withdrawConsentAction(formData: FormData): Promise<void> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  await controlQuery(
    `UPDATE consents SET withdrawn_at = now() WHERE tenant_id = $1 AND kind = 'call_recording_ai' AND withdrawn_at IS NULL`,
    [tenantId]
  );
  // 2.2.5: withdrawal DELETES the recording and the transcript. Content falls
  // back to the intake voice field automatically (getVoiceSource).
  const deleted = await controlQuery("DELETE FROM transcripts WHERE tenant_id = $1 RETURNING id", [tenantId]);
  await audit(s.email, tenantId, "consent.withdrawn", { transcripts_deleted: deleted.length });
  refreshAdmin();
}

export async function markCallHeldAction(formData: FormData): Promise<void> {
  const s = await staff();
  const callId = str(formData, "call_id");
  const tenantId = str(formData, "tenant_id");
  await controlQuery(
    "UPDATE onboarding_calls SET held_at = now(), recorded = $2, notes = $3 WHERE id = $1 AND tenant_id = $4",
    [callId, formData.get("recorded") === "on", str(formData, "notes"), tenantId]
  );
  await audit(s.email, tenantId, "call.held", { call_id: callId, recorded: formData.get("recorded") === "on" });
  refreshAdmin();
}

export async function uploadTranscriptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  const body = str(formData, "body");
  const verbal = formData.get("verbal_consent") === "on";
  if (body.length < 20) return { status: "error", message: "Paste the actual transcript." };

  // 2.2.3 HARD STOP: no written consent → the call should never have been
  // recorded. Refuse the transcript; notes-only is the lawful path.
  const written = await controlOne(
    "SELECT 1 FROM consents WHERE tenant_id = $1 AND kind = 'call_recording_ai' AND withdrawn_at IS NULL",
    [tenantId]
  );
  if (!written) {
    return {
      status: "error",
      message:
        "REFUSED: this tenant has no active written recording consent (2.2). If the call was recorded anyway, delete the recording — that's a §632 problem, not a data-entry problem. Use call notes instead.",
    };
  }
  if (!verbal) {
    return {
      status: "error",
      message:
        "REFUSED: verbal consent wasn't confirmed in the recording (2.2.2). If it was, tick the box; if it wasn't, the recording shouldn't exist — delete it and use notes.",
    };
  }

  const callId = str(formData, "call_id");
  await controlQuery(
    `INSERT INTO transcripts (tenant_id, call_id, body, recording_url, verbal_consent)
     VALUES ($1, $2, $3, $4, true)`,
    [tenantId, callId || null, body, str(formData, "recording_url") || null]
  );
  await audit(s.email, tenantId, "transcript.uploaded", { call_id: callId || null, chars: body.length });
  refreshAdmin();
  return { status: "ok", message: "Transcript stored under a complete consent chain." };
}

// ---------------------------------------------------------------------------
// Content seeding (2.6)
// ---------------------------------------------------------------------------

export async function seedContentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  try {
    const result = await seedContent(tenantId, s.email);
    refreshAdmin();
    return {
      status: "ok",
      message: `Drafted ${result.post_slugs.length} posts (${result.generator}, voice: ${result.voice}). They are UNPUBLISHED until you review and publish each one.`,
    };
  } catch (e) {
    if (e instanceof ConsentError) return { status: "error", message: e.message };
    return { status: "error", message: e instanceof Error ? e.message : "content seeding failed" };
  }
}

export async function publishPostAction(formData: FormData): Promise<void> {
  const s = await staff();
  await publishPost(str(formData, "tenant_id"), str(formData, "content_id"), s.email);
  refreshAdmin();
}

// ---------------------------------------------------------------------------
// Queue (Part 8) + pending actions (Part 4's human gate)
// ---------------------------------------------------------------------------

export async function resolveChangeRequestAction(formData: FormData): Promise<void> {
  const s = await staff();
  const id = str(formData, "cr_id");
  const tenantId = str(formData, "tenant_id");
  await controlQuery(
    `UPDATE change_requests SET staff_note = $2, resolved_at = now(), status = CASE WHEN status = 'escalated' THEN 'applied' ELSE status END
      WHERE id = $1 AND tenant_id = $3`,
    [id, str(formData, "note") || "handled", tenantId]
  );
  await audit(s.email, tenantId, "change_request.resolved", { cr_id: id, note: str(formData, "note") });
  refreshAdmin();
}

export async function decidePendingAction(formData: FormData): Promise<void> {
  const s = await staff();
  const id = str(formData, "action_id");
  const decision = str(formData, "decision"); // approve | dismiss
  const action = await controlOne<{ kind: string; tenant_id: string | null; status: string }>(
    "SELECT kind, tenant_id, status FROM pending_actions WHERE id = $1",
    [id]
  );
  if (!action || action.status !== "pending") return;

  if (decision === "approve" && action.kind === "suspend_tenant") {
    await approveSuspension(id, { id: s.id, email: s.email });
    refreshAdmin();
    return;
  }
  await controlQuery(
    `UPDATE pending_actions SET status = $2, decided_by = $3, decided_at = now(), note = $4 WHERE id = $1`,
    [id, decision === "approve" ? "approved" : "dismissed", s.id, str(formData, "note") || null]
  );
  await audit(s.email, action.tenant_id, `pending_action.${decision === "approve" ? "approved" : "dismissed"}`, {
    action_id: id,
    kind: action.kind,
  });
  refreshAdmin();
}

export async function resolveAlertAction(formData: FormData): Promise<void> {
  const s = await staff();
  await controlQuery(
    "UPDATE alerts SET resolved_at = now(), resolved_by = $2 WHERE id = $1 AND resolved_at IS NULL",
    [str(formData, "alert_id"), s.id]
  );
  refreshAdmin();
}

// ---------------------------------------------------------------------------
// Secrets (Part 3): rotation policy + expiry surfaced BEFORE the key dies
// ---------------------------------------------------------------------------

export async function setSecretRotationAction(formData: FormData): Promise<void> {
  const s = await staff();
  const tenantId = str(formData, "tenant_id");
  const key = str(formData, "integration_key");
  const expires = str(formData, "expires_at");
  const rotationDays = parseInt(str(formData, "rotation_days"), 10);
  await controlQuery(
    `UPDATE integrations SET secret_expires_at = $3, rotation_days = $4, updated_at = now()
      WHERE tenant_id = $1 AND key = $2`,
    [tenantId, key, expires ? new Date(expires).toISOString() : null, Number.isFinite(rotationDays) ? rotationDays : null]
  );
  await audit(s.email, tenantId, "secret.rotation_set", { key, expires_at: expires || null });
  refreshAdmin();
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function runJobsAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  await staff();
  const summary = await runAllJobs();
  refreshAdmin();
  const parts = Object.entries(summary)
    .filter(([k]) => !k.endsWith("_at"))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return { status: "ok", message: `Checks ran — ${parts.join(" · ")}` };
}
