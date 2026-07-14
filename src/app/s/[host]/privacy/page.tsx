import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";

export const metadata: Metadata = { title: "Privacy Policy" };

/**
 * Generated per tenant from the record (D13) — never pasted. Curbside is a
 * data processor holding lead PII for California businesses; CCPA/CPRA
 * language is baked in from row one. v1 sets no non-essential cookies and
 * runs cookieless analytics, so no consent banner is required — if that ever
 * changes, a CMP becomes mandatory (noted in ASSUMPTIONS.md).
 */
export default async function PrivacyPage({ params }: PageProps<"/s/[host]/privacy">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle || !bundle.profile) notFound();
  const p = bundle.profile;
  const name = bundle.tenant.business_name;
  const updated = "July 2026";

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div aria-hidden="true" className="mb-4 h-1.5 w-16 bg-accent" />
      <h1 className="font-display text-5xl text-ink">Privacy Policy</h1>
      <div className="prose-tenant mt-8">
        <p>Last updated: {updated}</p>
        <p>
          This website is operated for {name}, {p.nap.street}, {p.nap.city}, {p.nap.region}{" "}
          {p.nap.postal}. It is built and managed by Curbside Sites, which processes data on{" "}
          {name}&apos;s behalf as a service provider.
        </p>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Information you send us.</strong> When you submit a quote request, booking
            request, or newsletter signup, we collect what you enter: your name, contact details,
            details about your vehicle or job, your message, and any photos you attach.
          </li>
          <li>
            <strong>Basic usage signals.</strong> We record which actions happen on the site
            (for example, that a call button was tapped) so {name} can tell whether the website
            is doing its job. These records are not sold and are not used to profile you.
          </li>
        </ul>
        <h2>What we use it for</h2>
        <ul>
          <li>Responding to your request — that is the whole point of the form.</li>
          <li>Sending you the newsletter, if and only if you signed up. Every email includes a way out.</li>
          <li>Understanding, in aggregate, whether the website produces work for the shop.</li>
        </ul>
        <h2>What we do not do</h2>
        <ul>
          <li>We do not sell or share your personal information for cross-context behavioral advertising.</li>
          <li>We do not run third-party advertising trackers on this site.</li>
        </ul>
        <h2 id="ccpa">Your California privacy rights (CCPA/CPRA)</h2>
        <p>
          California residents may request: what personal information we hold about you, a copy of
          it, correction of it, or deletion of it. We honor all four without charge and without
          discrimination. Because we do not sell or share personal information as defined by the
          CPRA, there is nothing to opt out of — but if you want to exercise any right, contact{" "}
          {name} at {p.nap.phone_display} or visit the shop at {p.nap.street}, {p.nap.city},{" "}
          {p.nap.region}, and the request will be handled within 45 days.
        </p>
        <h2>Retention</h2>
        <p>
          Quote requests and their photos are kept while {name} may still need them to serve you,
          and deleted on request. Newsletter addresses are kept until you unsubscribe.
        </p>
        <h2>Questions</h2>
        <p>
          Call {name} at {p.nap.phone_display}. If your question is about the platform that runs
          this website, Curbside Sites can be reached via curbsidesites.com.
        </p>
      </div>
    </section>
  );
}
