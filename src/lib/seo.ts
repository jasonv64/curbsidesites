/**
 * SEO surfaces (Part 9), all generated from the tenant record (D2). Nothing
 * here is ever hand-maintained (Invariant 10).
 *
 * Invariant 6 note: everything in this file uses the CANONICAL NAP from
 * business_profile — never the DNI display number. Call tracking swaps the
 * number in rendered page components only.
 */
import type { TenantBundle } from "@/lib/tenant";
import type { ReviewsData } from "@/lib/adapters/reviews";
import { hoursRows, openingHoursSpec } from "@/lib/hours";

export function siteTitle(bundle: TenantBundle): string {
  return bundle.tenant.business_name;
}

export function defaultDescription(bundle: TenantBundle): string {
  const p = bundle.profile;
  const services = bundle.services.slice(0, 3).map((s) => s.name.toLowerCase()).join(", ");
  if (!p) return bundle.tenant.business_name;
  // Lead with service + city + phone (Part 9).
  return `${services || "Local service"} in ${p.nap.city}, ${p.nap.region}. ${bundle.tenant.business_name} — call ${p.nap.phone_display}.`;
}

/**
 * LocalBusiness (most specific subtype) + Service entries as one @graph.
 * aggregateRating is attached ONLY when live (non-demo) review rows exist
 * (Invariant 7) — fake structured data is a penalty applied to a real
 * person's livelihood.
 */
export function localBusinessJsonLd(
  bundle: TenantBundle,
  origin: string,
  reviews: ReviewsData | null
): object {
  const p = bundle.profile;
  if (!p) return {};
  const businessId = `${origin}/#business`;

  const business: Record<string, unknown> = {
    "@type": p.schema_subtype || "LocalBusiness",
    "@id": businessId,
    name: p.nap.name,
    url: origin,
    telephone: p.nap.phone_tel, // canonical, never DNI (Invariant 6)
    address: {
      "@type": "PostalAddress",
      streetAddress: p.nap.street,
      addressLocality: p.nap.city,
      addressRegion: p.nap.region,
      postalCode: p.nap.postal,
      addressCountry: "US",
    },
    ...(p.geo ? { geo: { "@type": "GeoCoordinates", latitude: p.geo.lat, longitude: p.geo.lng } } : {}),
    openingHoursSpecification: openingHoursSpec(p.hours),
    areaServed: p.service_area.map((a) => ({ "@type": "Place", name: a })),
    sameAs: [
      p.socials?.instagram ? `https://instagram.com/${p.socials.instagram.replace(/^@/, "")}` : null,
      p.socials?.facebook ?? null,
      p.socials?.youtube ?? null,
      p.socials?.yelp_url ?? null,
      p.socials?.google_maps_url ?? null,
    ].filter(Boolean),
  };

  // Invariant 7: live rows only. Demo rows NEVER produce aggregateRating.
  if (reviews && !reviews.isDemo && reviews.aggregate) {
    business.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: reviews.aggregate.rating,
      reviewCount: reviews.aggregate.count,
      bestRating: 5,
    };
  }

  const services = bundle.services.map((s) => ({
    "@type": "Service",
    name: s.name,
    description: s.blurb,
    url: `${origin}/services#${s.slug}`,
    provider: { "@id": businessId },
    areaServed: p.service_area.map((a) => ({ "@type": "Place", name: a })),
  }));

  return { "@context": "https://schema.org", "@graph": [business, ...services] };
}

export function articleJsonLd(
  bundle: TenantBundle,
  origin: string,
  post: { slug: string; frontmatter: { title: string; description: string; date: string; author: string } }
): object {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.frontmatter.title,
    description: post.frontmatter.description,
    datePublished: post.frontmatter.date,
    author: { "@type": "Person", name: post.frontmatter.author },
    publisher: { "@type": "Organization", name: bundle.tenant.business_name, url: origin },
    mainEntityOfPage: `${origin}/blog/${post.slug}`,
  };
}

/** llms.txt — a readme for robots (Part 9). Plain markdown, from the record. */
export function llmsTxt(bundle: TenantBundle, origin: string): string {
  const p = bundle.profile;
  const lines: string[] = [
    `# ${bundle.tenant.business_name}`,
    "",
    p?.tagline ? `> ${p.tagline}` : "",
    "",
    p?.about ? p.about.split("\n\n")[0] : "",
    "",
  ];
  if (p) {
    lines.push(
      "## Contact",
      "",
      `- Business: ${p.nap.name}`,
      `- Address: ${p.nap.street}, ${p.nap.city}, ${p.nap.region} ${p.nap.postal}`,
      `- Phone: ${p.nap.phone_display} (${p.nap.phone_tel})`, // canonical NAP (Invariant 6)
      `- Service area: ${p.service_area.join(", ")}`,
      "",
      "## Hours",
      ""
    );
    for (const { day, label } of hoursRows(p.hours)) lines.push(`- ${day}: ${label}`);
    lines.push("");
  }
  if (bundle.services.length > 0) {
    lines.push("## Services", "");
    for (const s of bundle.services) {
      lines.push(`- [${s.name}](${origin}/services#${s.slug}): ${s.blurb}`);
    }
    lines.push("");
  }
  lines.push(
    "## Key pages",
    "",
    `- [Home](${origin}/)`,
    `- [Services](${origin}/services)`,
    `- [About](${origin}/about)`,
    `- [Contact & quote requests](${origin}/contact)`,
    `- [Blog](${origin}/blog)`
  );
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";
}
