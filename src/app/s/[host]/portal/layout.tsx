import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Client portal",
  robots: { index: false, follow: false }, // belt; robots.txt is suspenders
};

/** Portal chrome. Auth is enforced per page (login lives at /portal itself). */
export default function PortalLayout({ children }: LayoutProps<"/s/[host]/portal">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-edge pb-4">
        <h1 className="font-display text-3xl text-ink">Your site portal</h1>
        <nav aria-label="Portal" className="flex flex-wrap gap-4 text-sm font-bold">
          <Link href="/portal" className="text-ink-muted hover:text-ink">Overview</Link>
          <Link href="/portal/leads" className="text-ink-muted hover:text-ink">Leads</Link>
          <Link href="/portal/reports" className="text-ink-muted hover:text-ink">Reports</Link>
          <Link href="/portal/content" className="text-ink-muted hover:text-ink">Posts</Link>
          <Link href="/portal/settings" className="text-ink-muted hover:text-ink">Hours &amp; services</Link>
          <Link href="/portal/chat" className="text-ink-muted hover:text-ink">Request a change</Link>
        </nav>
      </div>
      <div className="pt-8">{children}</div>
    </div>
  );
}
