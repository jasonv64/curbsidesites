"use client";

import { useActionState, useEffect, useRef } from "react";
import { submitLead, type LeadFormState } from "@/app/s/[host]/actions";

const initialState: LeadFormState = { status: "idle", message: "" };

const inputCls =
  "w-full border-2 border-edge bg-surface px-3 py-2.5 text-ink placeholder:text-ink-muted focus:border-accent";

/**
 * The quote / info request form (Part 8). Zod validates on both sides; the
 * honeypot field is visually hidden but present for bots; attribution fields
 * are filled client-side so the server action can attribute the conversion.
 */
export function QuoteForm({
  services,
  vehicleLabel,
  vehiclePlaceholder,
}: {
  services: { slug: string; name: string }[];
  vehicleLabel: string;
  vehiclePlaceholder: string;
}) {
  const [state, formAction, pending] = useActionState(submitLead, initialState);
  // Attribution values exist only in the browser; fill the hidden inputs
  // imperatively after hydration (no state — nothing re-renders).
  const referrerRef = useRef<HTMLInputElement>(null);
  const utmRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (referrerRef.current) referrerRef.current.value = document.referrer || "";
    if (utmRef.current) {
      utmRef.current.value = new URLSearchParams(window.location.search).get("utm_source") ?? "";
    }
  }, []);

  if (state.status === "sent") {
    return (
      <div role="status" className="border-2 border-accent bg-surface-raised p-6">
        <p className="font-display text-2xl text-ink">Request received.</p>
        <p className="mt-2 text-ink-muted">{state.message}</p>
      </div>
    );
  }

  const err = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} noValidate className="grid gap-4" aria-describedby="quote-form-status">
      <input type="hidden" name="_referrer" defaultValue="" ref={referrerRef} />
      <input type="hidden" name="_utm_source" defaultValue="" ref={utmRef} />
      {/* Honeypot — hidden from real users, present for bots */}
      <div className="absolute -left-[9999px] top-auto" aria-hidden="true">
        <label htmlFor="qf-website">Leave this field empty</label>
        <input id="qf-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="qf-name" className="mb-1 block text-sm font-bold text-ink">
            Name <span aria-hidden="true" className="text-accent">*</span>
          </label>
          <input id="qf-name" name="name" required autoComplete="name" className={inputCls}
            aria-invalid={!!err("name")} aria-describedby={err("name") ? "qf-name-err" : undefined} />
          {err("name") ? <p id="qf-name-err" className="mt-1 text-sm text-accent">{err("name")}</p> : null}
        </div>
        <div>
          <label htmlFor="qf-phone" className="mb-1 block text-sm font-bold text-ink">Phone</label>
          <input id="qf-phone" name="phone" type="tel" autoComplete="tel" className={inputCls}
            aria-invalid={!!err("phone")} aria-describedby={err("phone") ? "qf-phone-err" : undefined} />
          {err("phone") ? <p id="qf-phone-err" className="mt-1 text-sm text-accent">{err("phone")}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="qf-email" className="mb-1 block text-sm font-bold text-ink">Email</label>
          <input id="qf-email" name="email" type="email" autoComplete="email" className={inputCls}
            aria-invalid={!!err("email")} aria-describedby={err("email") ? "qf-email-err" : undefined} />
          {err("email") ? <p id="qf-email-err" className="mt-1 text-sm text-accent">{err("email")}</p> : null}
        </div>
        <div>
          <label htmlFor="qf-preferred" className="mb-1 block text-sm font-bold text-ink">
            Best way to reach you
          </label>
          <select id="qf-preferred" name="preferred" className={inputCls} defaultValue="phone">
            <option value="phone">Call me</option>
            <option value="text">Text me</option>
            <option value="email">Email me</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="qf-service" className="mb-1 block text-sm font-bold text-ink">
            What do you need?
          </label>
          <select id="qf-service" name="service" className={inputCls} defaultValue="">
            <option value="">Not sure yet</option>
            {services.map((s) => (
              <option key={s.slug} value={s.name}>{s.name}</option>
            ))}
            <option value="Something else">Something else</option>
          </select>
        </div>
        <div>
          <label htmlFor="qf-vehicle" className="mb-1 block text-sm font-bold text-ink">
            {vehicleLabel}
          </label>
          <input id="qf-vehicle" name="vehicle" placeholder={vehiclePlaceholder} className={inputCls} />
        </div>
      </div>

      <div>
        <label htmlFor="qf-message" className="mb-1 block text-sm font-bold text-ink">
          Tell us about the job <span aria-hidden="true" className="text-accent">*</span>
        </label>
        <textarea id="qf-message" name="message" required rows={4} className={inputCls}
          aria-invalid={!!err("message")} aria-describedby={err("message") ? "qf-message-err" : undefined} />
        {err("message") ? <p id="qf-message-err" className="mt-1 text-sm text-accent">{err("message")}</p> : null}
      </div>

      <div>
        <label htmlFor="qf-photos" className="mb-1 block text-sm font-bold text-ink">
          Photos <span className="font-normal text-ink-muted">(optional, up to 4)</span>
        </label>
        <input id="qf-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp"
          multiple className="block w-full text-sm text-ink-muted file:mr-3 file:border-2 file:border-edge file:bg-surface-raised file:px-3 file:py-2 file:text-sm file:font-bold file:text-ink" />
      </div>

      <div aria-live="polite" id="quote-form-status">
        {state.status === "error" ? (
          <p className="border-2 border-accent bg-surface-raised p-3 text-sm text-ink">{state.message}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="justify-self-start bg-accent px-8 py-3.5 font-bold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send my request"}
      </button>
    </form>
  );
}
