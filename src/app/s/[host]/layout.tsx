import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTenantBundle, canonicalOrigin } from "@/lib/tenant";
import { brandStyle, resolveTokens } from "@/lib/brand";
import { getDisplayNumber } from "@/lib/adapters/call-tracking";
import { getAnalytics } from "@/lib/adapters/analytics";
import { getReviews } from "@/lib/adapters/reviews";
import { defaultDescription, localBusinessJsonLd } from "@/lib/seo";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { StickyCallBar } from "@/components/site/sticky-call-bar";
import { UnderConstruction } from "@/components/site/under-construction";

/**
 * The tenant layout: one hostname in, one branded site out.
 *
 * Status gates (Part 2):
 *   draft     → platform subdomain only (resolver enforces), preview cookie
 *               or nothing, always noindex
 *   live      → everything on
 *   suspended → the dignified under-construction page, every path (D20)
 */
export async function generateMetadata({
  params,
}: LayoutProps<"/s/[host]">): Promise<Metadata> {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) return { title: "Not found" };
  const origin = canonicalOrigin(bundle, bundle.hostKind, decodeURIComponent(host));
  // Platform subdomains are a sales/preview surface — never indexed, so the
  // custom domain is the only canonical copy in search.
  const noindex = bundle.tenant.status !== "live" || bundle.hostKind === "platform";
  return {
    metadataBase: new URL(origin),
    title: {
      default: bundle.tenant.business_name,
      template: `%s | ${bundle.tenant.business_name}`,
    },
    description: defaultDescription(bundle),
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
    icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
    manifest: "/site.webmanifest",
    openGraph: {
      siteName: bundle.tenant.business_name,
      type: "website",
      images: [{ url: "/og", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image" },
    alternates: {
      canonical: "./",
      types: { "application/rss+xml": `${origin}/feed.xml` },
    },
  };
}

export default async function TenantLayout({
  children,
  params,
}: LayoutProps<"/s/[host]">) {
  const { host } = await params;
  const rawHost = decodeURIComponent(host);
  const bundle = await getTenantBundle(rawHost);
  if (!bundle) notFound();

  const tokens = resolveTokens(bundle.brand?.tokens);
  const styleCss = brandStyle(tokens, bundle.brand?.font_pairing_key);

  // Suspended: under-construction on every path. One field flip (D20).
  if (bundle.tenant.status === "suspended") {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: styleCss }} />
        <UnderConstruction bundle={bundle} />
      </>
    );
  }

  // Draft: staff/preview only. The cookie is set by the ?preview=<token>
  // handshake in src/proxy.ts. This branch is the only cookies() call on the
  // render path, so live tenants stay fully cacheable.
  if (bundle.tenant.status === "draft") {
    const jar = await cookies();
    if (jar.get("cs_preview")?.value !== bundle.tenant.preview_token) notFound();
  }

  const [displayNumber, analytics, reviews] = await Promise.all([
    getDisplayNumber(bundle),
    getAnalytics(bundle),
    getReviews(bundle.tenant.id),
  ]);
  const origin = canonicalOrigin(bundle, bundle.hostKind, rawHost);
  const jsonLd = localBusinessJsonLd(bundle, origin, reviews);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styleCss }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {analytics.enabled ? (
        <script defer data-domain={analytics.dataDomain ?? undefined} src={analytics.scriptSrc} />
      ) : null}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
      >
        Skip to content
      </a>
      <SiteHeader bundle={bundle} displayNumber={displayNumber} />
      <main id="main" className="grow pb-14 md:pb-0">
        {children}
      </main>
      <SiteFooter bundle={bundle} />
      <StickyCallBar displayNumber={displayNumber} />
    </>
  );
}
