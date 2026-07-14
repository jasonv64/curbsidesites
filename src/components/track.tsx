"use client";

/**
 * Conversion beacons (D14). Fire-and-forget sendBeacon to /api/track — the
 * navigation (tel:, maps) proceeds instantly; losing a beacon is acceptable,
 * blocking a phone call is not.
 */
import type { ReactNode } from "react";

function beacon(type: string, payload: Record<string, unknown> = {}) {
  try {
    const body = JSON.stringify({
      type,
      payload: {
        ...payload,
        path: window.location.pathname,
        referrer: document.referrer || null,
        utm_source: new URLSearchParams(window.location.search).get("utm_source"),
      },
    });
    if (!navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }))) {
      fetch("/api/track", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* never interfere with the tap */
  }
}

export function CallLink({
  tel,
  className,
  children,
  ariaLabel,
}: {
  tel: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <a
      href={`tel:${tel}`}
      className={className}
      aria-label={ariaLabel}
      onClick={() => beacon("call_tap")}
    >
      {children}
    </a>
  );
}

export function MapLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() => beacon("map_tap")}
    >
      {children}
    </a>
  );
}
