import Link from "next/link";

/** Landing stub — the real marketing site is Session 5's deliverable. */
export default function PlatformHome() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl">Your shop deserves a site that works as hard as you do.</h1>
      <p className="max-w-prose text-ink-muted">
        Fast, accessible, built to turn searches into phone calls — and maintained for you, every
        month, so it stays that way. Tell us about your business and see your draft site in
        minutes, not weeks.
      </p>
      <Link
        href="/onboard"
        className="self-start rounded bg-brand px-8 py-3 text-lg font-semibold text-on-brand"
      >
        Start your site →
      </Link>
    </div>
  );
}
