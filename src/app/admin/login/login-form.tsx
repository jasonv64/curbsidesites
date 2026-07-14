"use client";

import { useActionState, useEffect } from "react";
import { enrollAction, loginAction, mfaAction, type LoginState } from "./actions";

const inputCls = "w-full rounded border border-edge bg-surface px-3 py-2";

export function LoginForm() {
  const [state, action, pending] = useActionState(
    async (prev: LoginState, formData: FormData) => {
      const step = String(formData.get("_step"));
      if (step === "mfa") return mfaAction(prev, formData);
      if (step === "enroll") return enrollAction(prev, formData);
      return loginAction(prev, formData);
    },
    { step: "password" } as LoginState
  );

  // Full navigation on purpose — see the LoginState note in actions.ts.
  useEffect(() => {
    if (state.step === "done") window.location.assign("/");
  }, [state.step]);

  if (state.step === "done") {
    return <p className="text-sm text-ink-muted">Signed in — loading the fleet…</p>;
  }

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="_step" value={state.step} />
      {state.error && (
        <p role="alert" className="rounded border border-accent bg-surface-raised p-2 text-sm">
          {state.error}
        </p>
      )}

      {state.step === "password" && (
        <>
          <div>
            <label htmlFor="email" className="text-sm font-semibold">Email</label>
            <input id="email" name="email" type="email" required autoComplete="username" className={inputCls} />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-semibold">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" className={inputCls} />
          </div>
        </>
      )}

      {state.step === "mfa" && (
        <div>
          <label htmlFor="code" className="text-sm font-semibold">Authenticator code</label>
          <input id="code" name="code" inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoFocus className={inputCls} />
        </div>
      )}

      {state.step === "enroll" && (
        <>
          <div className="rounded border border-edge bg-surface-raised p-3 text-sm">
            <p className="font-semibold">Set up your authenticator (required, one time).</p>
            <p className="mt-2">
              In Google Authenticator / 1Password / Authy, add an account by URI or key:
            </p>
            <p className="mt-2 break-all font-mono text-xs">{state.otpauth}</p>
            <p className="mt-2">
              Manual entry key: <span className="font-mono">{state.secret}</span>
            </p>
          </div>
          <div>
            <label htmlFor="code" className="text-sm font-semibold">Enter the 6-digit code to confirm</label>
            <input id="code" name="code" inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoFocus className={inputCls} />
          </div>
        </>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-semibold text-on-brand disabled:opacity-60"
      >
        {pending ? "…" : state.step === "password" ? "Sign in" : "Verify"}
      </button>
    </form>
  );
}
