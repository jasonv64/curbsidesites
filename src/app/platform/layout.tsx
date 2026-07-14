import type { Metadata } from "next";

/**
 * The platform surface: what serves on the bare apex (curbsidesites.com in
 * production, localhost in dev). Today it is a landing stub plus the intake
 * form (Part 2.1); Session 5 grows it into the real marketing site.
 * noindex until then — the intake form shouldn't be the first thing Google
 * learns about the company.
 */
export const metadata: Metadata = {
  title: { default: "Curbside Sites", template: "%s — Curbside Sites" },
  robots: { index: false, follow: false },
};

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10">
      <header className="mb-10">
        <p className="font-display text-2xl">Curbside Sites</p>
        <p className="text-sm text-ink-muted">Websites that answer the phone. Built for local service businesses.</p>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-16 border-t border-edge pt-4 text-sm text-ink-muted">
        © {new Date().getFullYear()} Curbside Sites · hello@curbsidesites.com
      </footer>
    </div>
  );
}
