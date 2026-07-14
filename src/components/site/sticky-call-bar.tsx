import Link from "next/link";
import type { DisplayNumber } from "@/lib/adapters/call-tracking";
import { CallLink } from "@/components/track";

/**
 * The customer is standing in a parking lot (Part 6). On mobile, the call
 * action is always one thumb away. Hidden on md+ where the header CTA shows.
 */
export function StickyCallBar({ displayNumber }: { displayNumber: DisplayNumber }) {
  if (!displayNumber.tel) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 border-t-2 border-edge md:hidden">
      <CallLink
        tel={displayNumber.tel}
        className="bg-brand py-3.5 text-center text-sm font-bold text-on-brand"
        ariaLabel={`Call now: ${displayNumber.display}`}
      >
        Call {displayNumber.display}
      </CallLink>
      <Link
        href="/contact#quote"
        className="bg-accent py-3.5 text-center text-sm font-bold text-on-accent"
      >
        Get a quote
      </Link>
    </div>
  );
}
