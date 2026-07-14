import { getPayments } from "@/lib/adapters/payments";
import { CallLink } from "@/components/track";
import type { SectionData } from "@/lib/section-data";

/**
 * Payments — STUB (D7). Demo mode is an explicit, friendly callout with the
 * phone number. NEVER a fake success, never an error. Feature-flag-gated.
 */
export async function PaymentsCallout({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string };
}) {
  if (!data.bundle.tenant.features?.payments) return null;
  const payments = await getPayments(data.bundle);
  if (payments.kind !== "demo_callout") return null; // live checkout ships later

  return (
    <section className="mx-auto max-w-6xl px-4 pb-16">
      <div className="border-2 border-edge bg-surface-raised p-6 sm:p-8">
        <h2 className="font-display text-2xl text-ink">{props.heading ?? "Paying an invoice?"}</h2>
        <p className="mt-2 max-w-2xl text-ink-muted">{payments.message}</p>
        {payments.phoneTel ? (
          <CallLink
            tel={payments.phoneTel}
            className="mt-4 inline-block bg-brand px-6 py-3 font-bold text-on-brand transition-opacity hover:opacity-90"
          >
            Call {payments.phoneDisplay}
          </CallLink>
        ) : null}
      </div>
    </section>
  );
}
