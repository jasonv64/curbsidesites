import Link from "next/link";
import type { TenantBundle } from "@/lib/tenant";
import { hoursRows } from "@/lib/hours";
import { CallLink, MapLink } from "@/components/track";

/**
 * Invariant 11: the Curbside credit varies its anchor text AND target per
 * tenant — 200 identical footer links is a link-scheme footprint that would
 * penalize every client at once. Deterministic per slug.
 */
const CREDITS: { text: string; href: string }[] = [
  { text: "Website by Curbside Sites", href: "https://curbsidesites.com" },
  { text: "Built and managed by Curbside Sites", href: "https://curbsidesites.com/how-it-works" },
  { text: "Site care by Curbside Sites", href: "https://curbsidesites.com/care-plans" },
  { text: "Web design for local shops — Curbside Sites", href: "https://curbsidesites.com/work" },
  { text: "Powered by Curbside Sites", href: "https://curbsidesites.com/#platform" },
];

function creditFor(slug: string): { text: string; href: string } {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return CREDITS[Math.abs(h) % CREDITS.length];
}

export function SiteFooter({ bundle }: { bundle: TenantBundle }) {
  const p = bundle.profile;
  const credit = creditFor(bundle.tenant.slug);
  const year = new Date().getFullYear();
  const mapsUrl =
    p?.socials?.google_maps_url ??
    (p ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.nap.name} ${p.nap.street} ${p.nap.city} ${p.nap.region}`)}` : "#");

  return (
    <footer className="border-t-2 border-edge bg-brand-dark text-on-brand-dark">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="font-display text-2xl">{bundle.tenant.business_name}</p>
          {p?.tagline ? <p className="mt-2 text-sm opacity-80">{p.tagline}</p> : null}
          {p ? (
            <address className="mt-4 text-sm not-italic leading-relaxed opacity-80">
              {/* NAP renders from its single home (Invariant 6) */}
              {p.nap.street}
              <br />
              {p.nap.city}, {p.nap.region} {p.nap.postal}
            </address>
          ) : null}
          {p ? (
            <CallLink tel={p.nap.phone_tel} className="mt-2 inline-block text-sm font-bold underline underline-offset-4">
              {p.nap.phone_display}
            </CallLink>
          ) : null}
        </div>

        <div>
          <h2 className="font-display text-lg">Services</h2>
          <ul className="mt-3 space-y-2 text-sm opacity-80">
            {bundle.services.slice(0, 6).map((s) => (
              <li key={s.slug}>
                <Link href={`/services#${s.slug}`} className="hover:underline">
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-display text-lg">Hours</h2>
          <ul className="mt-3 space-y-1 text-sm opacity-80">
            {hoursRows(p?.hours ?? {}).map((r) => (
              <li key={r.day} className="flex justify-between gap-4">
                <span>{r.day}</span>
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-display text-lg">Find us</h2>
          <ul className="mt-3 space-y-2 text-sm opacity-80">
            <li>
              <MapLink href={mapsUrl} className="hover:underline">
                Get directions
              </MapLink>
            </li>
            {p?.socials?.instagram ? (
              <li>
                <a
                  href={`https://instagram.com/${p.socials.instagram.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  Instagram
                </a>
              </li>
            ) : null}
            {p?.socials?.facebook ? (
              <li>
                <a href={p.socials.facebook} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  Facebook
                </a>
              </li>
            ) : null}
            {p?.socials?.yelp_url ? (
              <li>
                <a href={p.socials.yelp_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  Yelp
                </a>
              </li>
            ) : null}
            <li>
              <Link href="/portal" className="hover:underline">
                Client portal
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-edge/30">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs opacity-70">
          <p>
            © {year} {bundle.tenant.business_name}. All rights reserved.
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-4">
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <Link href="/terms" className="hover:underline">Terms</Link>
            <Link href="/accessibility" className="hover:underline">Accessibility</Link>
            <Link href="/privacy#ccpa" className="hover:underline">Do Not Sell or Share My Personal Information</Link>
          </nav>
          <p>
            <a href={credit.href} rel="noopener" className="hover:underline">
              {credit.text}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
