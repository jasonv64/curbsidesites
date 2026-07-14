import type { NewsletterSync } from "./types";

/** Demo = row in our table only. Nothing external. */
export const demoNewsletterSync: NewsletterSync = {
  async sync() {
    return { synced: false, demo: true };
  },
};
