import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getDisplayNumber } from "@/lib/adapters/call-tracking";
import { RenderSections } from "@/lib/section-registry";

export async function generateMetadata({ params }: PageProps<"/s/[host]/about">): Promise<Metadata> {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return {};
  const p = bundle.profile;
  return {
    title: "About",
    description: `About ${bundle.tenant.business_name}${p ? ` in ${p.nap.city}, ${p.nap.region}. Call ${p.nap.phone_display}.` : "."}`,
  };
}

export default async function AboutPage({ params }: PageProps<"/s/[host]/about">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const displayNumber = await getDisplayNumber(bundle);
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pt-16">
        <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
        <h1 className="font-display text-5xl text-ink sm:text-6xl">About</h1>
      </section>
      <RenderSections data={{ bundle, displayNumber }} page="about" />
    </>
  );
}
