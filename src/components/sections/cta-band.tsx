import Link from "next/link";
import { CallLink } from "@/components/track";
import type { SectionData } from "@/lib/section-data";

/** The closer. Brand field, one message, two ways to act. */
export function CtaBand({
  data,
  props,
}: {
  data: SectionData;
  props: { headline?: string; sub?: string };
}) {
  const { displayNumber } = data;
  return (
    <section className="bg-brand">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-4xl text-on-brand sm:text-5xl">
            {props.headline ?? "Ready when you are."}
          </h2>
          {props.sub ? <p className="mt-2 text-lg text-on-brand/80">{props.sub}</p> : null}
        </div>
        <div className="flex flex-wrap gap-3">
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
            className="border-2 border-on-brand/40 px-8 py-4 text-lg font-bold text-on-brand transition-colors hover:border-on-brand"
          >
            Request a quote
          </Link>
        </div>
      </div>
    </section>
  );
}
