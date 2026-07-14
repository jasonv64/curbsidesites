import Link from "next/link";
import { TenantImage } from "@/components/tenant-image";
import { CallLink } from "@/components/track";
import type { SectionData } from "@/lib/section-data";

/**
 * Full-bleed hero. Image (or branded placeholder) behind a directional dark
 * scrim — heaviest at the text edge (Part 10) — with big display type set
 * low-left on a visible grid. Not a centered SaaS hero, deliberately.
 */
export function Hero({
  data,
  props,
}: {
  data: SectionData;
  props: { headline?: string; sub?: string; image_slot?: string };
}) {
  const { bundle, displayNumber } = data;
  const headline = props.headline ?? bundle.profile?.tagline ?? bundle.tenant.business_name;
  const city = bundle.profile?.nap.city;
  const sub =
    props.sub ??
    (city ? `${bundle.tenant.business_name} — ${city}, ${bundle.profile?.nap.region}` : bundle.tenant.business_name);

  return (
    <section className="relative isolate min-h-[72svh] overflow-hidden bg-brand-dark">
      <TenantImage
        images={bundle.images}
        slot={props.image_slot ?? "hero"}
        fill
        priority
        sizes="100vw"
        altOverride=""
      />
      {/* scrim: readable copy over any image, tuned heavier at the text edge */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-brand-dark via-brand-dark/60 to-brand-dark/20"
      />
      <div className="relative mx-auto flex min-h-[72svh] max-w-6xl flex-col justify-end px-4 pb-14 pt-24">
        <div aria-hidden="true" className="mb-6 h-1.5 w-24 bg-accent" />
        <h1 className="font-display max-w-4xl text-5xl text-on-brand-dark sm:text-7xl lg:text-8xl">
          {headline}
        </h1>
        <p className="mt-4 max-w-2xl text-lg font-medium text-on-brand-dark/80">{sub}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          {displayNumber.tel ? (
            <CallLink
              tel={displayNumber.tel}
              className="bg-accent px-8 py-4 text-lg font-bold text-on-accent transition-opacity hover:opacity-90"
              ariaLabel={`Call now: ${displayNumber.display}`}
            >
              Call {displayNumber.display}
            </CallLink>
          ) : null}
          <Link
            href="/contact#quote"
            className="border-2 border-on-brand-dark/40 px-8 py-4 text-lg font-bold text-on-brand-dark transition-colors hover:border-on-brand-dark"
          >
            Get a quote
          </Link>
        </div>
      </div>
    </section>
  );
}
