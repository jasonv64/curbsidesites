/**
 * Newsletter adapter. The subscriber row ALWAYS lands in our subscribers
 * table (that write happens in the server action, not here — our DB is the
 * source of truth). This adapter is only the optional ESP sync on top.
 */
export interface NewsletterSync {
  /** Push a confirmed subscriber to the external ESP audience. */
  sync(email: string): Promise<{ synced: boolean; demo: boolean }>;
}
