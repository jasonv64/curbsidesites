import { TenantImage } from "@/components/tenant-image";
import type { SectionData } from "@/lib/section-data";

/** The shop's story in their own voice, image offset against the grid. */
export function AboutStory({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string; image_slot?: string; text?: string };
}) {
  const { bundle } = data;
  const text =
    props.text ??
    bundle.profile?.about ??
    `${bundle.tenant.business_name} is a local shop that does the work right the first time. Come by and talk to us — we'd rather show you than tell you.`;

  return (
    <section className="bg-surface-raised">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:py-24 lg:grid-cols-2">
        <div className="relative -mb-6 lg:mb-0 lg:-mt-32">
          <TenantImage
            images={bundle.images}
            slot={props.image_slot ?? "about-shop"}
            className="w-full border-2 border-edge object-cover"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        </div>
        <div>
          <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
          <h2 className="font-display text-4xl text-ink sm:text-5xl">
            {props.heading ?? "Who you're dealing with"}
          </h2>
          <div className="mt-5 space-y-4 text-lg leading-relaxed text-ink-muted">
            {text.split(/\n\n+/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
