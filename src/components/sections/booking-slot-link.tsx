"use client";

import Link from "next/link";

/** Slot tile: beacons booking_started, then routes into the quote form. */
export function BookingSlotLink({ label }: { label: string }) {
  return (
    <Link
      href="/contact#quote"
      className="block border-2 border-edge bg-surface px-4 py-4 text-center font-bold text-ink transition-colors hover:border-accent"
      onClick={() => {
        try {
          const body = JSON.stringify({ type: "booking_started", payload: { slot: label } });
          navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }));
        } catch {
          /* never block the tap */
        }
      }}
    >
      {label}
    </Link>
  );
}
