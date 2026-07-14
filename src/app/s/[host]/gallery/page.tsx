import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getDisplayNumber } from "@/lib/adapters/call-tracking";
import { RenderSections } from "@/lib/section-registry";

export async function generateMetadata({ params }: PageProps<"/s/[host]/gallery">): Promise<Metadata> {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return {};
  return {
    title: "Gallery",
    description: `Recent work by ${bundle.tenant.business_name}${bundle.profile ? ` in ${bundle.profile.nap.city}, ${bundle.profile.nap.region}` : ""}.`,
  };
}

export default async function GalleryPage({ params }: PageProps<"/s/[host]/gallery">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const displayNumber = await getDisplayNumber(bundle);
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pt-16">
        <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
        <h1 className="font-display text-5xl text-ink sm:text-6xl">The work</h1>
      </section>
      <RenderSections data={{ bundle, displayNumber }} page="gallery" />
    </>
  );
}
