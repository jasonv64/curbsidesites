import type { BookingAvailability } from "./types";

// TODO: LIVE — real booking: slot inventory owned by the shop (or a calendar
// integration), double-booking prevention, confirmation email/SMS, and
// booking_completed events. Sold à la carte at $79/mo (D19).
export function liveAvailability(): BookingAvailability {
  throw new Error(
    "booking live mode is not implemented in v1. " +
      "Edit src/lib/adapters/booking/live.ts → liveAvailability(). " +
      "Until then the integration row must stay mode='demo'."
  );
}
