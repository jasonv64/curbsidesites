"use client";

import { logoutAction } from "../login/actions";

/** Hard navigation after logout — see the LoginState note in login/actions.ts. */
export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await logoutAction();
        window.location.assign("/login");
      }}
      className="rounded border border-edge px-3 py-1 hover:text-accent"
    >
      Sign out
    </button>
  );
}
