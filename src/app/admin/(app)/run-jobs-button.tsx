"use client";

import { useActionState } from "react";
import { runJobsAction, type ActionState } from "./actions";

export function RunJobsButton() {
  const [state, action, pending] = useActionState(runJobsAction, {
    status: "idle",
    message: "",
  } as ActionState);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-edge px-3 py-1.5 text-sm font-semibold hover:text-accent disabled:opacity-60"
      >
        {pending ? "Running checks…" : "Run checks now"}
      </button>
      {state.message && (
        <p className="max-w-xl text-right text-xs text-ink-muted">{state.message}</p>
      )}
    </form>
  );
}
