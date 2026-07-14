import type { SectionData } from "@/lib/section-data";

/**
 * FAQ — native <details>, zero JS. Emits FAQPage JSON-LD (Part 9: FAQ content
 * is what LLMs and featured snippets quote). Content comes from section props,
 * i.e. the database, never hardcoded.
 */
export function Faq({
  props,
}: {
  data: SectionData;
  props: { heading?: string; items?: { q: string; a: string }[] };
}) {
  const items = props.items ?? [];
  if (items.length === 0) return null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  };

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
        <div>
          <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
          <h2 className="font-display text-4xl text-ink sm:text-5xl">
            {props.heading ?? "Straight answers"}
          </h2>
        </div>
        <div className="divide-y-2 divide-edge border-y-2 border-edge">
          {items.map((item) => (
            <details key={item.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-ink [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  aria-hidden="true"
                  className="shrink-0 text-2xl text-accent transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 leading-relaxed text-ink-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
