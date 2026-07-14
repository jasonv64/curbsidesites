import Link from "next/link";
import type { SectionData } from "@/lib/section-data";

/**
 * Services from the tenant record (D2: adding a service row propagates here
 * with zero edits). Asymmetric two-column rhythm, numbered like a spec sheet.
 */
export function ServicesGrid({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string; show_blurbs?: boolean };
}) {
  const services = data.bundle.services;
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
        <div>
          <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
          <h2 className="font-display text-4xl text-ink sm:text-5xl">
            {props.heading ?? "What we do"}
          </h2>
          <Link
            href="/services"
            className="mt-6 inline-block font-bold text-accent underline underline-offset-4"
          >
            Every service, in detail →
          </Link>
        </div>

        {services.length === 0 ? (
          <p className="self-center text-lg text-ink-muted">
            Full service list coming soon — call us and ask; if it rolls, floats, or works for a
            living, we probably handle it.
          </p>
        ) : (
          <ol className="grid gap-px border-2 border-edge bg-edge sm:grid-cols-2">
            {services.map((s, i) => (
              <li key={s.slug} className="bg-surface p-6">
                <span aria-hidden="true" className="font-display text-sm text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display mt-1 text-2xl text-ink">
                  <Link href={`/services#${s.slug}`} className="hover:text-accent">
                    {s.name}
                  </Link>
                </h3>
                {props.show_blurbs !== false && s.blurb ? (
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.blurb}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
