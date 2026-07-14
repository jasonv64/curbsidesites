"use client";

/**
 * Change-request chat (D9): the client asks in plain language, the parser
 * proposes a typed diff, THE CLIENT confirms — nothing auto-applies. This UI
 * renders that loop; the safety lives in the server actions.
 */
import { useActionState, useState } from "react";
import { proposeChange, confirmChange, type ChatState } from "@/app/s/[host]/portal/actions";

const idle: ChatState = { status: "idle", message: "" };

interface LogEntry {
  who: "you" | "curbside";
  text: string;
}

export function ChatUi() {
  const [log, setLog] = useState<LogEntry[]>([
    {
      who: "curbside",
      text: "Tell me what you'd like changed on the site — hours, services, your tagline. I'll confirm before anything goes live.",
    },
  ]);
  const [proposal, proposeAction, proposing] = useActionState(
    async (prev: ChatState, formData: FormData) => {
      const message = String(formData.get("message") ?? "");
      const next = await proposeChange(prev, formData);
      setLog((l) => [...l, { who: "you", text: message }, { who: "curbside", text: next.message }]);
      return next;
    },
    idle
  );
  const [, confirmAction, confirming] = useActionState(
    async (prev: ChatState, formData: FormData) => {
      const next = await confirmChange(prev, formData);
      setLog((l) => [...l, { who: "curbside", text: next.message }]);
      return next;
    },
    idle
  );

  const awaitingConfirm = proposal.status === "proposed" && proposal.requestId;

  return (
    <div className="max-w-2xl border-2 border-edge">
      <div className="max-h-96 space-y-3 overflow-y-auto p-5" aria-live="polite">
        {log.map((entry, i) => (
          <p
            key={i}
            className={
              entry.who === "you"
                ? "ml-auto max-w-[85%] bg-brand px-4 py-2.5 text-sm text-on-brand"
                : "max-w-[85%] bg-surface-raised px-4 py-2.5 text-sm text-ink"
            }
          >
            {entry.text}
          </p>
        ))}
      </div>

      {awaitingConfirm ? (
        <div className="flex gap-2 border-t-2 border-edge p-4">
          <form action={confirmAction} className="contents">
            <input type="hidden" name="request_id" value={proposal.requestId} />
            <button
              type="submit"
              name="decision"
              value="confirm"
              disabled={confirming}
              className="bg-accent px-5 py-2.5 font-bold text-on-accent disabled:opacity-50"
            >
              Yes, make the change
            </button>
            <button
              type="submit"
              name="decision"
              value="cancel"
              disabled={confirming}
              className="border-2 border-edge px-5 py-2.5 font-bold text-ink disabled:opacity-50"
            >
              No, cancel
            </button>
          </form>
        </div>
      ) : (
        <form
          action={proposeAction}
          className="flex gap-2 border-t-2 border-edge p-4"
        >
          <label htmlFor="chat-message" className="sr-only">
            What would you like changed?
          </label>
          <input
            id="chat-message"
            name="message"
            required
            placeholder='e.g. "make Saturday 8 to 2"'
            className="w-full border-2 border-edge bg-surface px-3 py-2.5 text-ink placeholder:text-ink-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={proposing}
            className="shrink-0 bg-accent px-5 py-2.5 font-bold text-on-accent disabled:opacity-50"
          >
            {proposing ? "…" : "Send"}
          </button>
        </form>
      )}
    </div>
  );
}
