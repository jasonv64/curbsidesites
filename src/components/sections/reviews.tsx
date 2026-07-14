import { getReviews } from "@/lib/adapters/reviews";
import type { SectionData } from "@/lib/section-data";

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span aria-label={`${rating} out of 5 stars`} className="text-accent" role="img">
      <span aria-hidden="true">{"★".repeat(full)}{"☆".repeat(5 - full)}</span>
    </span>
  );
}

/**
 * Reviews from OUR cached rows (D10 — no vendor call at request time).
 * Demo rows get the one quiet label D5 requires. aggregateRating JSON-LD is
 * emitted by the page layout, never here, and only for live rows (Inv. 7).
 */
export async function Reviews({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string; limit?: number };
}) {
  const { reviews, aggregate, isDemo } = await getReviews(data.bundle.tenant.id);
  if (reviews.length === 0) return null;

  return (
    <section className="bg-brand-dark">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
            <h2 className="font-display text-4xl text-on-brand-dark sm:text-5xl">
              {props.heading ?? "What customers say"}
            </h2>
          </div>
          {aggregate ? (
            <p className="text-on-brand-dark/90">
              <span className="font-display text-5xl">{aggregate.rating.toFixed(1)}</span>{" "}
              <Stars rating={aggregate.rating} />{" "}
              <span className="text-sm opacity-80">({aggregate.count} reviews)</span>
            </p>
          ) : null}
        </div>

        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {reviews.slice(0, props.limit ?? 6).map((r) => (
            <li key={r.id} className="flex flex-col border-2 border-edge/30 bg-brand-dark p-5">
              <Stars rating={Number(r.rating)} />
              <blockquote className="mt-3 grow text-sm leading-relaxed text-on-brand-dark/90">
                “{r.body}”
              </blockquote>
              <p className="mt-4 text-sm font-bold text-on-brand-dark">
                {r.author}
                <span className="ml-2 font-normal capitalize opacity-60">via {r.source}</span>
              </p>
            </li>
          ))}
        </ul>

        {isDemo ? (
          <p className="mt-6 text-xs text-on-brand-dark/60">
            Sample reviews — the live feed activates once review sources are connected.
          </p>
        ) : null}
      </div>
    </section>
  );
}
