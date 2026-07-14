import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";

export const metadata: Metadata = { title: "Accessibility Statement" };

/** Every tenant ships an accessibility statement (D12). */
export default async function AccessibilityPage({
  params,
}: PageProps<"/s/[host]/accessibility">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle || !bundle.profile) notFound();
  const p = bundle.profile;
  const name = bundle.tenant.business_name;

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
      <h1 className="font-display text-5xl text-ink">Accessibility</h1>
      <div className="prose-tenant mt-8">
        <p>
          {name} wants every customer to be able to use this website, including customers who rely
          on assistive technology.
        </p>
        <h2>Our standard</h2>
        <p>
          This site is built to conform to the Web Content Accessibility Guidelines (WCAG) 2.2,
          Level AA. Conformance is checked automatically against every page — including this
          site&apos;s specific colors and typography — before any update ships, and violations
          block the release.
        </p>
        <h2>What that looks like in practice</h2>
        <ul>
          <li>Every page works with a keyboard alone.</li>
          <li>Images carry meaningful alternative text.</li>
          <li>Text colors meet AA contrast against their backgrounds.</li>
          <li>Forms label every field and announce their errors.</li>
          <li>Motion is minimal and respects your reduced-motion preference.</li>
        </ul>
        <h2>Found a problem?</h2>
        <p>
          If any part of this site is hard for you to use, please tell us — it will get fixed.
          Call {name} at {p.nap.phone_display}, or visit us at {p.nap.street}, {p.nap.city},{" "}
          {p.nap.region} {p.nap.postal}. You&apos;ll reach a person, and we can also help you with
          anything the website does over the phone instead.
        </p>
      </div>
    </section>
  );
}
