import type { TenantBundle } from "@/lib/tenant";
import { CallLink } from "@/components/track";

/**
 * The suspended state (D20): dignified, not broken. The business's name and
 * phone keep working — how you treat someone on the way out is a marketing
 * channel in a referral market.
 */
export function UnderConstruction({ bundle }: { bundle: TenantBundle }) {
  const p = bundle.profile;
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-brand-dark px-4 text-center">
      <div aria-hidden="true" className="mb-8 h-1.5 w-24 bg-accent" />
      <h1 className="font-display max-w-3xl text-5xl text-on-brand-dark sm:text-6xl">
        {bundle.tenant.business_name}
      </h1>
      <p className="mt-6 max-w-xl text-lg text-on-brand-dark/80">
        Our website is getting some work done. The shop is very much open — call us and we&apos;ll
        take care of you.
      </p>
      {p ? (
        <CallLink
          tel={p.nap.phone_tel}
          className="mt-8 bg-accent px-8 py-4 text-xl font-bold text-on-accent"
        >
          {p.nap.phone_display}
        </CallLink>
      ) : null}
      {p ? (
        <p className="mt-6 text-sm text-on-brand-dark/60">
          {p.nap.street} · {p.nap.city}, {p.nap.region} {p.nap.postal}
        </p>
      ) : null}
    </main>
  );
}
