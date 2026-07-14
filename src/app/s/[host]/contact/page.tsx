import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getDisplayNumber } from "@/lib/adapters/call-tracking";
import { RenderSections } from "@/lib/section-registry";

export async function generateMetadata({ params }: PageProps<"/s/[host]/contact">): Promise<Metadata> {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return {};
  const p = bundle.profile;
  return {
    title: "Contact",
    description: p
      ? `Contact ${bundle.tenant.business_name} — ${p.nap.street}, ${p.nap.city}, ${p.nap.region}. Call ${p.nap.phone_display} or request a quote online.`
      : `Contact ${bundle.tenant.business_name}.`,
  };
}

export default async function ContactPage({ params }: PageProps<"/s/[host]/contact">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const displayNumber = await getDisplayNumber(bundle);
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pt-16">
        <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
        <h1 className="font-display text-5xl text-ink sm:text-6xl">Contact</h1>
      </section>
      <RenderSections data={{ bundle, displayNumber }} page="contact" />
    </>
  );
}
