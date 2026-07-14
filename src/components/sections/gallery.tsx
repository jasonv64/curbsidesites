import { TenantImage } from "@/components/tenant-image";
import type { SectionData } from "@/lib/section-data";

/**
 * Work gallery. Renders the tenant's gallery-purpose image slots; slots with
 * no upload yet serve branded placeholders, so the layout is always full
 * (Part 10). Uneven row heights on large screens — engineered, not carded.
 */
export function Gallery({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string; limit?: number };
}) {
  const slots = data.bundle.images
    .filter((i) => i.purpose === "gallery")
    .slice(0, props.limit ?? 6);
  // A tenant with no gallery rows at all still gets a finished section.
  const ids = slots.length > 0 ? slots.map((s) => s.slot_id) : ["gallery-1", "gallery-2", "gallery-3"];
  // CC-licensed stock (Part 10 sourcing) requires attribution; site-wide
  // credits render here. Instagram slots carry permalinks in credit, not
  // attributions, so they're excluded.
  const credits = data.bundle.images.filter((i) => i.credit && i.purpose !== "instagram");

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
      <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
      <h2 className="font-display text-4xl text-ink sm:text-5xl">
        {props.heading ?? "Recent work"}
      </h2>
      <ul className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {ids.map((slot, i) => (
          <li
            key={slot}
            className={`relative overflow-hidden border-2 border-edge ${i % 5 === 0 ? "col-span-2 aspect-[2/1]" : "aspect-square"}`}
          >
            <TenantImage
              images={data.bundle.images}
              slot={slot}
              fill
              sizes="(min-width: 1024px) 33vw, 50vw"
            />
          </li>
        ))}
      </ul>
      {credits.length > 0 && (
        <details className="mt-6 text-xs text-ink-muted">
          <summary className="cursor-pointer font-semibold">Photo credits</summary>
          <ul className="mt-2 space-y-1">
            {credits.map((c) => (
              <li key={c.slot_id}>{c.credit}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
