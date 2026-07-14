import { QuoteForm } from "@/components/forms/quote-form";
import type { SectionData } from "@/lib/section-data";

export function QuoteFormSection({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string; sub?: string; vehicle_label?: string; vehicle_placeholder?: string };
}) {
  return (
    <section id="quote" className="scroll-mt-8 bg-surface-raised">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <div>
            <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
            <h2 className="font-display text-4xl text-ink sm:text-5xl">
              {props.heading ?? "Get a quote"}
            </h2>
            <p className="mt-4 leading-relaxed text-ink-muted">
              {props.sub ??
                "Tell us what you're working with and what you want done. Photos help — we'll get back to you fast with a straight answer."}
            </p>
          </div>
          <div>
            <QuoteForm
              services={data.bundle.services.map((s) => ({ slug: s.slug, name: s.name }))}
              vehicleLabel={props.vehicle_label ?? "Vehicle"}
              vehiclePlaceholder={props.vehicle_placeholder ?? "Year, make, model"}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
