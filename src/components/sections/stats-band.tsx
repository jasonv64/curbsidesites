import type { SectionData } from "@/lib/section-data";

/** Confident numbers on a hard band. Empty stats → renders nothing at all. */
export function StatsBand({
  props,
}: {
  data: SectionData;
  props: { stats?: { value: string; label: string }[] };
}) {
  const stats = props.stats ?? [];
  if (stats.length === 0) return null;
  return (
    <section className="border-y-2 border-edge bg-surface-raised">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px sm:grid-cols-4">
        {stats.slice(0, 4).map((s) => (
          <div key={s.label} className="px-4 py-8 text-center sm:py-10">
            <dd className="font-display text-4xl text-accent sm:text-5xl">{s.value}</dd>
            <dt className="mt-1 text-sm font-semibold text-ink-muted">{s.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
