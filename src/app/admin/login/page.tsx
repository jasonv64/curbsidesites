import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/control/staff-auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Staff sign-in — Curbside Sites",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  if (await requireStaff()) redirect("/");
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="font-display text-3xl">Curbside control plane</h1>
        <p className="text-sm text-ink-muted">Staff only. Password + authenticator code.</p>
      </div>
      <LoginForm />
    </main>
  );
}
