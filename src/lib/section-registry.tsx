/**
 * THE SECTION REGISTRY (D17, Part 5).
 *
 * Core exposes named, typed sections; a tenant's `sections` rows declare
 * which render, on which page, in what order, with what props. Every section
 * is safe to enable in any order with any data — empty data degrades to a
 * sensible empty state or renders nothing, never a broken layout.
 *
 * Adding a section: add the component, add one entry here (name → component
 * + Zod props schema). That's the whole change — available to every tenant.
 *
 * Custom per-tenant sections (D17 escape hatch) register under
 * "custom/<client-slug>/<name>" from clients/<slug>/sections/* — none exist
 * yet; the naming convention is reserved so core never collides with them.
 */
import { z } from "zod";
import type { ComponentType } from "react";
import type { SectionData } from "@/lib/section-data";
import { Hero } from "@/components/sections/hero";
import { StatsBand } from "@/components/sections/stats-band";
import { ServicesGrid } from "@/components/sections/services-grid";
import { AboutStory } from "@/components/sections/about-story";
import { Gallery } from "@/components/sections/gallery";
import { Reviews } from "@/components/sections/reviews";
import { InstagramStrip } from "@/components/sections/instagram-strip";
import { Faq } from "@/components/sections/faq";
import { CtaBand } from "@/components/sections/cta-band";
import { ContactBlock } from "@/components/sections/contact-block";
import { QuoteFormSection } from "@/components/sections/quote-form-section";
import { NewsletterSection } from "@/components/sections/newsletter-section";
import { BookingTeaser } from "@/components/sections/booking-teaser";
import { PaymentsCallout } from "@/components/sections/payments-callout";
import { QuoteAssistantSection } from "@/components/sections/quote-assistant-section";

interface RegistryEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<{ data: SectionData; props: any }>;
  propsSchema: z.ZodTypeAny;
}

const stats = z.object({ value: z.string(), label: z.string() });
const faqItem = z.object({ q: z.string(), a: z.string() });

export const sectionRegistry: Record<string, RegistryEntry> = {
  hero: {
    Component: Hero,
    propsSchema: z.object({
      headline: z.string().optional(),
      sub: z.string().optional(),
      image_slot: z.string().optional(),
    }),
  },
  "stats-band": {
    Component: StatsBand,
    propsSchema: z.object({ stats: z.array(stats).optional() }),
  },
  "services-grid": {
    Component: ServicesGrid,
    propsSchema: z.object({ heading: z.string().optional(), show_blurbs: z.boolean().optional() }),
  },
  "about-story": {
    Component: AboutStory,
    propsSchema: z.object({
      heading: z.string().optional(),
      image_slot: z.string().optional(),
      text: z.string().optional(),
    }),
  },
  gallery: {
    Component: Gallery,
    propsSchema: z.object({ heading: z.string().optional(), limit: z.number().int().positive().optional() }),
  },
  reviews: {
    Component: Reviews,
    propsSchema: z.object({ heading: z.string().optional(), limit: z.number().int().positive().optional() }),
  },
  "instagram-strip": {
    Component: InstagramStrip,
    propsSchema: z.object({ heading: z.string().optional() }),
  },
  faq: {
    Component: Faq,
    propsSchema: z.object({ heading: z.string().optional(), items: z.array(faqItem).optional() }),
  },
  "cta-band": {
    Component: CtaBand,
    propsSchema: z.object({ headline: z.string().optional(), sub: z.string().optional() }),
  },
  "contact-block": {
    Component: ContactBlock,
    propsSchema: z.object({ heading: z.string().optional() }),
  },
  "quote-form": {
    Component: QuoteFormSection,
    propsSchema: z.object({
      heading: z.string().optional(),
      sub: z.string().optional(),
      vehicle_label: z.string().optional(),
      vehicle_placeholder: z.string().optional(),
    }),
  },
  newsletter: {
    Component: NewsletterSection,
    propsSchema: z.object({ heading: z.string().optional(), sub: z.string().optional() }),
  },
  // Stubbed features — the price list (D19). Flag-gated inside each component.
  "booking-teaser": {
    Component: BookingTeaser,
    propsSchema: z.object({ heading: z.string().optional() }),
  },
  "payments-callout": {
    Component: PaymentsCallout,
    propsSchema: z.object({ heading: z.string().optional() }),
  },
  "quote-assistant": {
    Component: QuoteAssistantSection,
    propsSchema: z.object({ heading: z.string().optional() }),
  },
};

/**
 * Default composition per page, used when a tenant has NO sections rows for
 * that page. This is what makes the D11 bar real: a brand-new tenant row
 * with nothing configured still renders a complete, screenshot-ready site.
 */
const DEFAULT_SECTIONS: Record<string, string[]> = {
  home: ["hero", "services-grid", "about-story", "reviews", "faq", "cta-band"],
  services: ["cta-band"],
  about: ["about-story", "cta-band"],
  gallery: ["gallery", "instagram-strip", "cta-band"],
  contact: ["contact-block", "quote-form", "newsletter"],
};

/**
 * Render one page's sections from config. Unknown names and invalid props are
 * skipped with one console.error — a bad row must never 500 a live site.
 */
export function RenderSections({
  data,
  page,
}: {
  data: SectionData;
  page: string;
}) {
  let rows = data.bundle.sections
    .filter((s) => s.page === page)
    .sort((a, b) => a.sort_order - b.sort_order);
  if (rows.length === 0) {
    rows = (DEFAULT_SECTIONS[page] ?? []).map((name, i) => ({
      page,
      section_name: name,
      sort_order: i,
      props: {},
    }));
  }

  return (
    <>
      {rows.map((row, i) => {
        const entry = sectionRegistry[row.section_name];
        if (!entry) {
          console.error(
            `[sections] tenant '${data.bundle.tenant.slug}' page '${page}': unknown section '${row.section_name}' — skipped`
          );
          return null;
        }
        const parsed = entry.propsSchema.safeParse(row.props ?? {});
        if (!parsed.success) {
          console.error(
            `[sections] tenant '${data.bundle.tenant.slug}' page '${page}': invalid props for '${row.section_name}' — skipped:`,
            parsed.error.issues.map((e) => e.message).join("; ")
          );
          return null;
        }
        const { Component } = entry;
        return <Component key={`${row.section_name}-${i}`} data={data} props={parsed.data} />;
      })}
    </>
  );
}
