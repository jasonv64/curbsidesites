/**
 * Transactional email adapter — Resend (chosen in ASSUMPTIONS.md per D3
 * "pick one"). Used for lead notifications and portal magic links.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailResult {
  /** True only when the provider accepted the message. Demo mode is false. */
  sent: boolean;
  demo: boolean;
  /**
   * Demo mode exposes the message here so local flows (e.g. the magic-link
   * login) remain usable without a provider key.
   */
  demoPreview?: { to: string; subject: string; text: string };
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<EmailResult>;
}
