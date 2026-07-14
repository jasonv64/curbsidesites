import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/control/staff-auth";
import { LogoutButton } from "./logout-button";

export const metadata: Metadata = {
  title: { default: "Control plane — Curbside Sites", template: "%s — Curbside control plane" },
  robots: { index: false, follow: false },
};

/**
 * THE staff guard (D16). Every page in this group renders only behind a
 * password + TOTP session; anything else bounces to /login. Server actions
 * re-check independently — the layout is UX, requireStaff() is the security.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!staff) redirect("/login");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-edge pb-4">
        <div className="flex items-baseline gap-6">
          <p className="font-display text-xl">Curbside control plane</p>
          <nav className="flex gap-4 text-sm font-semibold">
            <Link href="/" className="hover:text-accent">Fleet</Link>
            <Link href="/queue" className="hover:text-accent">Queue</Link>
            <Link href="/alerts" className="hover:text-accent">Alerts</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <span>{staff.name} ({staff.role})</span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
