import { NewsletterForm } from "@/components/forms/newsletter-form";
import type { SectionData } from "@/lib/section-data";

export function NewsletterSection({
  props,
}: {
  data: SectionData;
  props: { heading?: string; sub?: string };
}) {
  return (
    <section className="border-y-2 border-edge">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-12 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-3xl text-ink">
            {props.heading ?? "Worth-your-time updates"}
          </h2>
          <p className="mt-1 text-ink-muted">
            {props.sub ?? "Seasonal checklists and shop news. No spam, ever."}
          </p>
        </div>
        <NewsletterForm />
      </div>
    </section>
  );
}
