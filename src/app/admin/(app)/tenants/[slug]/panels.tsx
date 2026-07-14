"use client";

/**
 * The tenant-detail forms whose outcome must be READ (go-live gate refusals,
 * consent refusals, provisioning results). Plain fire-and-forget staff
 * actions stay as server-component forms.
 */
import { useActionState } from "react";
import {
  goLiveAction,
  provisionDomainAction,
  seedContentAction,
  uploadTranscriptAction,
  type ActionState,
} from "../../actions";

const idle: ActionState = { status: "idle", message: "" };
const inputCls = "rounded border border-edge bg-surface px-3 py-1.5 text-sm";

function Feedback({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role="status"
      className={`rounded border p-2 text-sm ${state.status === "error" ? "border-accent font-semibold" : "border-edge text-ink-muted"}`}
    >
      {state.message}
    </p>
  );
}

export function GoLivePanel({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState(goLiveAction, idle);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="force" />
        Go live on the platform subdomain only (no verified custom domain yet)
      </label>
      <button type="submit" disabled={pending} className="self-start rounded bg-brand px-4 py-2 text-sm font-semibold text-on-brand disabled:opacity-60">
        {pending ? "Checking gates…" : "Flip live"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ProvisionDomainPanel({ tenantId, suggested }: { tenantId: string; suggested?: string }) {
  const [state, action, pending] = useActionState(provisionDomainAction, idle);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input
        name="hostname"
        defaultValue={suggested}
        placeholder="shopname.com"
        aria-label="Domain to provision"
        className={inputCls}
      />
      <button type="submit" disabled={pending} className="rounded border border-edge px-3 py-1.5 text-sm font-semibold hover:text-accent disabled:opacity-60">
        {pending ? "Creating…" : "Provision via Cloudflare + email instructions"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function TranscriptPanel({ tenantId, callId }: { tenantId: string; callId?: string }) {
  const [state, action, pending] = useActionState(uploadTranscriptAction, idle);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      {callId && <input type="hidden" name="call_id" value={callId} />}
      <textarea name="body" rows={4} placeholder="Paste the call transcript…" aria-label="Call transcript" className={inputCls} />
      <input name="recording_url" placeholder="Recording URL (optional)" aria-label="Recording URL" className={inputCls} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="verbal_consent" className="mt-0.5" />
        <span>
          Verbal consent was captured <strong>in the recording itself</strong>, at the top of the
          call, from every participant (2.2.2). Unticked = this upload is refused.
        </span>
      </label>
      <button type="submit" disabled={pending} className="self-start rounded border border-edge px-3 py-1.5 text-sm font-semibold hover:text-accent disabled:opacity-60">
        {pending ? "Checking consent chain…" : "Store transcript"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function SeedContentPanel({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState(seedContentAction, idle);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <button type="submit" disabled={pending} className="self-start rounded border border-edge px-3 py-1.5 text-sm font-semibold hover:text-accent disabled:opacity-60">
        {pending ? "Drafting…" : "Seed content (2–3 draft posts + site copy)"}
      </button>
      <p className="text-xs text-ink-muted">
        Uses the consented transcript when one exists, otherwise the intake voice field. Refuses an
        unconsented transcript outright (2.2.4). Drafts stay unpublished until reviewed.
      </p>
      <Feedback state={state} />
    </form>
  );
}
