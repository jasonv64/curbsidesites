"use client";

import { useActionState } from "react";
import { subscribeNewsletter, type NewsletterFormState } from "@/app/s/[host]/actions";

const initialState: NewsletterFormState = { status: "idle", message: "" };

export function NewsletterForm() {
  const [state, formAction, pending] = useActionState(subscribeNewsletter, initialState);

  if (state.status === "sent") {
    return (
      <p role="status" className="font-bold text-ink">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
      <div className="absolute -left-[9999px] top-auto" aria-hidden="true">
        <label htmlFor="nl-website">Leave this field empty</label>
        <input id="nl-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label htmlFor="nl-email" className="sr-only">
        Email address
      </label>
      <input
        id="nl-email"
        name="email"
        type="email"
        required
        placeholder="you@example.com"
        autoComplete="email"
        className="w-full border-2 border-edge bg-surface px-3 py-2.5 text-ink placeholder:text-ink-muted focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 bg-brand px-6 py-2.5 font-bold text-on-brand transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Joining…" : "Sign up"}
      </button>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-accent sm:self-center">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
