import type { EmailSender } from "./types";

/** Resend REST API, plain fetch. config.from must be a verified sender. */
export function liveEmailSender(apiKey: string, config: Record<string, string>): EmailSender {
  return {
    async send(msg) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: config.from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          ...(msg.html ? { html: msg.html } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      return { sent: true, demo: false };
    },
  };
}
