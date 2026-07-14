/**
 * Booking adapter — STUB, fully typed and demo-wired (the price list, D19).
 * Demo mode computes plausible availability from the tenant's real business
 * hours so the client can SEE it working; submitting routes into the quote
 * form as a normal lead. // TODO: LIVE — real slot inventory + confirmation.
 */
export interface BookingSlot {
  /** ISO date, local to the shop. */
  date: string;
  /** "09:00" */
  time: string;
  label: string; // "Tue Jul 14, 9:00 AM"
}

export interface BookingAvailability {
  slots: BookingSlot[];
  isDemo: boolean;
}
