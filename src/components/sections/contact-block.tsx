import { hoursRows } from "@/lib/hours";
import { CallLink, MapLink } from "@/components/track";
import type { SectionData } from "@/lib/section-data";

/** NAP + hours + directions. Everything renders from business_profile (Inv. 6). */
export function ContactBlock({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string };
}) {
  const p = data.bundle.profile;
  const { displayNumber } = data;
  if (!p) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-4xl text-ink">{props.heading ?? "Visit the shop"}</h2>
        <p className="mt-4 text-ink-muted">Contact details coming soon.</p>
      </section>
    );
  }
  const mapsUrl =
    p.socials?.google_maps_url ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.nap.name} ${p.nap.street} ${p.nap.city} ${p.nap.region}`)}`;

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
      <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
      <h2 className="font-display text-4xl text-ink sm:text-5xl">
        {props.heading ?? "Visit the shop"}
      </h2>
      <div className="mt-8 grid gap-8 border-2 border-edge sm:grid-cols-3">
        <div className="p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">Address</h3>
          <address className="mt-2 not-italic leading-relaxed text-ink">
            {p.nap.name}
            <br />
            {p.nap.street}
            <br />
            {p.nap.city}, {p.nap.region} {p.nap.postal}
          </address>
          <MapLink href={mapsUrl} className="mt-3 inline-block font-bold text-accent underline underline-offset-4">
            Get directions →
          </MapLink>
        </div>
        <div className="border-t-2 border-edge p-6 sm:border-l-2 sm:border-t-0">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">Phone</h3>
          <CallLink tel={displayNumber.tel} className="font-display mt-2 block text-3xl text-ink hover:text-accent">
            {displayNumber.display}
          </CallLink>
          <p className="mt-2 text-sm text-ink-muted">
            Serving {p.service_area.slice(0, 3).join(", ")}
            {p.service_area.length > 3 ? " and beyond" : ""}.
          </p>
        </div>
        <div className="border-t-2 border-edge p-6 sm:border-l-2 sm:border-t-0">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">Hours</h3>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {hoursRows(p.hours).map((r) => (
              <li key={r.day} className="flex justify-between gap-3">
                <span className="text-ink-muted">{r.day}</span>
                <span className="font-semibold">{r.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
