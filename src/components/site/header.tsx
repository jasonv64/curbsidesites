import Link from "next/link";
import Image from "next/image";
import type { TenantBundle } from "@/lib/tenant";
import type { DisplayNumber } from "@/lib/adapters/call-tracking";
import { CallLink } from "@/components/track";

const NAV = [
  { href: "/services", label: "Services" },
  { href: "/about", label: "About" },
  { href: "/gallery", label: "Gallery" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({
  bundle,
  displayNumber,
}: {
  bundle: TenantBundle;
  displayNumber: DisplayNumber;
}) {
  const logo = bundle.brand?.logo_url;
  return (
    <header className="border-b-2 border-edge bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          {logo ? (
            <Image src={logo} alt="" width={40} height={40} className="h-10 w-10 object-contain" />
          ) : (
            <span aria-hidden="true" className="block h-8 w-2 shrink-0 bg-accent" />
          )}
          <span className="font-display truncate text-2xl text-ink">
            {bundle.tenant.business_name}
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        {displayNumber.tel ? (
          <CallLink
            tel={displayNumber.tel}
            className="hidden shrink-0 bg-brand px-4 py-2 text-sm font-bold text-on-brand transition-opacity hover:opacity-90 sm:block"
            ariaLabel={`Call ${bundle.tenant.business_name} at ${displayNumber.display}`}
          >
            {displayNumber.display}
          </CallLink>
        ) : null}
      </div>

      {/* Mobile nav: horizontal scroll strip, thumb-reachable, no JS. */}
      <nav
        aria-label="Main mobile"
        className="flex gap-5 overflow-x-auto border-t border-edge px-4 py-2 md:hidden"
      >
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="whitespace-nowrap text-sm font-semibold text-ink-muted"
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
