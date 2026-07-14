import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";

export const metadata: Metadata = { title: "Terms of Use" };

/** Generated per tenant from the record (D13). */
export default async function TermsPage({ params }: PageProps<"/s/[host]/terms">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle || !bundle.profile) notFound();
  const p = bundle.profile;
  const name = bundle.tenant.business_name;

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
      <h1 className="font-display text-5xl text-ink">Terms of Use</h1>
      <div className="prose-tenant mt-8">
        <p>Last updated: July 2026</p>
        <h2>The short version</h2>
        <p>
          This website belongs to {name}. It exists so you can learn about the shop, see the work,
          and get in touch. Use it for that and we&apos;ll get along fine.
        </p>
        <h2>Quotes and estimates</h2>
        <p>
          Numbers on this site — including anything produced by the quote form or an estimate
          assistant — are ballparks, not binding offers. Final pricing always comes from{" "}
          {name} directly after looking at the actual job. Call {p.nap.phone_display} for a real
          quote.
        </p>
        <h2>Content</h2>
        <p>
          Text, photos, and branding on this site belong to {name} or their licensors. Don&apos;t
          scrape, republish, or pass any of it off as your own.
        </p>
        <h2>No warranties on the website itself</h2>
        <p>
          We work hard to keep the site accurate and available, but it is provided as-is. Hours
          and availability can change — when in doubt, call.
        </p>
        <h2>Disputes</h2>
        <p>
          These terms are governed by California law. Anything serious gets resolved in the courts
          of the county where {name} operates ({p.nap.city}, {p.nap.region}).
        </p>
      </div>
    </section>
  );
}
