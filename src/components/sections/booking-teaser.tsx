import { getAvailability } from "@/lib/adapters/booking";
import { BookingSlotLink } from "./booking-slot-link";
import type { SectionData } from "@/lib/section-data";

/**
 * Booking — STUB, demo-wired (the price list, D19). Slots are computed from
 * the shop's real hours; picking one records booking_started and routes into
 * the quote form. // TODO: LIVE — real inventory + confirmation
 * (src/lib/adapters/booking/live.ts).
 */
export async function BookingTeaser({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string };
}) {
  // Feature-flag-gated: only renders when the tenant's plan includes booking.
  if (!data.bundle.tenant.features?.booking) return null;
  const availability = await getAvailability(data.bundle);
  if (availability.slots.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
      <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
      <h2 className="font-display text-4xl text-ink sm:text-5xl">
        {props.heading ?? "Book a time"}
      </h2>
      <p className="mt-3 max-w-2xl text-ink-muted">
        Pick a slot that works and tell us what you need — we&apos;ll confirm by phone or text.
      </p>
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {availability.slots.map((slot) => (
          <li key={`${slot.date}-${slot.time}`}>
            <BookingSlotLink label={slot.label} />
          </li>
        ))}
      </ul>
      {availability.isDemo ? (
        <p className="mt-4 text-xs text-ink-muted">
          Sample availability — live booking activates with the booking add-on.
        </p>
      ) : null}
    </section>
  );
}
