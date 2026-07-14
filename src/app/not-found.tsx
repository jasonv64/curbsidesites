/**
 * Unknown host / unknown route: a clean 404, never a broken tenant page
 * (Part 2). Neutral fallback tokens from globals.css — no tenant context here.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-surface px-4 text-center">
      <p className="font-display text-7xl text-ink">404</p>
      <h1 className="mt-4 text-xl font-bold text-ink">There&apos;s no site here.</h1>
      <p className="mt-2 max-w-md text-ink-muted">
        Check the address — this domain or page isn&apos;t serving a site right now.
      </p>
    </main>
  );
}
