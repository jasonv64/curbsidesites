import type { NewsletterSync } from "./types";

/** Resend Audiences REST API. config.audience_id from the Resend dashboard. */
export function liveNewsletterSync(
  apiKey: string,
  config: Record<string, string>
): NewsletterSync {
  return {
    async sync(email) {
      const res = await fetch(
        `https://api.resend.com/audiences/${encodeURIComponent(config.audience_id)}/contacts`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ email, unsubscribed: false }),
        }
      );
      if (!res.ok) throw new Error(`Resend audience ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { synced: true, demo: false };
    },
  };
}
