import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getDisplayNumber } from "@/lib/adapters/call-tracking";
import { RenderSections } from "@/lib/section-registry";
import { Markdown } from "@/components/markdown";
import { TenantImage, findImage } from "@/components/tenant-image";
import { CallLink } from "@/components/track";

export async function generateMetadata({ params }: PageProps<"/s/[host]/services">): Promise<Metadata> {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return {};
  const city = bundle.profile?.nap.city;
  return {
    title: "Services",
    description: `${bundle.services.map((s) => s.name).slice(0, 4).join(", ")}${city ? ` in ${city}, ${bundle.profile?.nap.region}` : ""}. ${bundle.profile?.nap.phone_display ?? ""}`.trim(),
  };
}

/**
 * Services: one anchored section per service row (D2 — adding a service row
 * adds a page section, a nav anchor, a form option, a sitemap entry, and a
 * JSON-LD Service with zero other edits).
 */
export default async function ServicesPage({ params }: PageProps<"/s/[host]/services">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const displayNumber = await getDisplayNumber(bundle);

  return (
    <>
      <section className="bg-brand-dark">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
          <h1 className="font-display text-5xl text-on-brand-dark sm:text-6xl">Services</h1>
          <p className="mt-4 max-w-2xl text-lg text-on-brand-dark/80">
            Straight talk about what we do, what it costs to do it right, and what to expect.
          </p>
          {bundle.services.length > 0 ? (
            <nav aria-label="Services on this page" className="mt-8 flex flex-wrap gap-2">
              {bundle.services.map((s) => (
                <a
                  key={s.slug}
                  href={`#${s.slug}`}
                  className="border-2 border-on-brand-dark/30 px-4 py-2 text-sm font-bold text-on-brand-dark transition-colors hover:border-accent"
                >
                  {s.name}
                </a>
              ))}
            </nav>
          ) : null}
        </div>
      </section>

      {bundle.services.length === 0 ? (
        <section className="mx-auto max-w-6xl px-4 py-16">
          <p className="text-lg text-ink-muted">
            The full service list is on its way. Call {displayNumber.display} and ask — if it
            rolls, floats, or works for a living, we probably handle it.
          </p>
        </section>
      ) : (
        bundle.services.map((service, i) => {
          const imageSlot = `service-${service.slug}`;
          const hasImage = !!findImage(bundle.images, imageSlot);
          return (
            <section
              key={service.slug}
              id={service.slug}
              aria-labelledby={`${service.slug}-h`}
              className={`scroll-mt-8 ${i % 2 === 1 ? "bg-surface-raised" : ""}`}
            >
              <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-2">
                <div className={i % 2 === 1 ? "lg:order-2" : ""}>
                  <span aria-hidden="true" className="font-display text-sm text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 id={`${service.slug}-h`} className="font-display mt-1 text-4xl text-ink">
                    {service.name}
                  </h2>
                  <p className="mt-3 text-lg text-ink-muted">{service.blurb}</p>
                  {service.body ? (
                    <div className="mt-4">
                      <Markdown body={service.body} />
                    </div>
                  ) : null}
                  <div className="mt-6 flex flex-wrap gap-3">
                    <CallLink
                      tel={displayNumber.tel}
                      className="bg-brand px-6 py-3 font-bold text-on-brand transition-opacity hover:opacity-90"
                    >
                      Call about {service.name.toLowerCase()}
                    </CallLink>
                  </div>
                </div>
                {hasImage ? (
                  <div className={i % 2 === 1 ? "lg:order-1" : ""}>
                    <TenantImage
                      images={bundle.images}
                      slot={imageSlot}
                      className="w-full border-2 border-edge object-cover"
                      sizes="(min-width: 1024px) 50vw, 100vw"
                    />
                  </div>
                ) : null}
              </div>
            </section>
          );
        })
      )}

      <RenderSections data={{ bundle, displayNumber }} page="services" />
    </>
  );
}
