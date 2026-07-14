import type { EmailSender } from "./types";

/**
 * Demo email = logged to the server console, never sent. The magic-link
 * flow prints its link here in local dev; nothing is lost, nothing leaves
 * the machine.
 */
export const demoEmailSender: EmailSender = {
  async send(msg) {
    console.log(
      `[email:demo] would send to=${msg.to} subject=${JSON.stringify(msg.subject)}\n` +
        msg.text.split("\n").map((l) => `  | ${l}`).join("\n")
    );
    return { sent: false, demo: true, demoPreview: { to: msg.to, subject: msg.subject, text: msg.text } };
  },
};
