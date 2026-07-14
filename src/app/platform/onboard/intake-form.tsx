"use client";

/**
 * The public intake form (Part 2.1). Everything on it becomes database rows —
 * the add-on checkboxes are the feature flags, the consent checkboxes are the
 * consents rows, and the success panel is the tenant's live preview link.
 */
import { useActionState, useState } from "react";
import { submitIntake, type IntakeFormState } from "./actions";

const INDUSTRIES: [string, string][] = [
  ["automotive", "Automotive / Off-road"],
  ["marine", "Marine / Boat service"],
  ["hvac", "Heating & Air (HVAC)"],
  ["plumbing", "Plumbing"],
  ["electrical", "Electrical"],
  ["roofing", "Roofing"],
  ["landscaping", "Landscaping / Outdoor"],
  ["fencing", "Fencing / Welding / Fabrication"],
  ["painting", "Painting"],
  ["cleaning", "Cleaning / Detailing"],
  ["general", "Other local service"],
];

const REGISTRARS = [
  "GoDaddy",
  "Namecheap",
  "Squarespace Domains (ex-Google)",
  "Cloudflare",
  "IONOS",
  "Network Solutions",
  "Other / not sure",
  "No domain yet",
];

const ADDONS: [string, string, string][] = [
  ["crm", "CRM", "Track every lead from first call to closed job"],
  ["payments", "Online payments", "Take deposits and invoices online"],
  ["booking", "Online booking", "Let customers grab a slot themselves"],
  ["blog", "Blog", "Monthly posts that answer what your customers search"],
  ["seo", "Local SEO / visibility", "Google Business Profile, citations, rankings"],
  ["monthly_reporting", "Monthly reporting", "One page: did the site make you money"],
  ["call_tracking", "Call tracking", "Know which calls came from the site"],
];

const DAYS: [string, string][] = [
  ["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"],
  ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"],
];

const initial: IntakeFormState = { status: "idle", message: "" };

function Field({
  label, name, error, children,
}: {
  label: string; name: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-semibold">{label}</label>
      {children}
      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </div>
  );
}

const inputCls =
  "rounded border border-edge bg-surface px-3 py-2 text-ink placeholder:text-ink-muted/60";

export function IntakeForm() {
  const [state, action, pending] = useActionState(submitIntake, initial);
  const [services, setServices] = useState([0, 1, 2]);
  const [nextId, setNextId] = useState(3);
  const err = state.fieldErrors ?? {};

  if (state.status === "sent" && state.previewUrl) {
    return (
      <div className="rounded-lg border border-edge bg-surface-raised p-8">
        <h2 className="font-display text-3xl">Your site is already building.</h2>
        <p className="mt-3 text-ink-muted">{state.message}</p>
        <a
          href={state.previewUrl}
          className="mt-6 inline-block rounded bg-brand px-6 py-3 font-semibold text-on-brand"
        >
          Open your private preview →
        </a>
        <p className="mt-4 text-sm text-ink-muted">
          This link is just for you — the site isn&apos;t public yet. We also emailed it to you,
          along with your kickoff call time
          {state.callAt
            ? ` (${new Date(state.callAt).toLocaleString("en-US", {
                weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
              })})`
            : ""}.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-8">
      {state.status === "error" && (
        <p role="alert" className="rounded border border-accent bg-surface-raised p-3 text-sm">
          {state.message}
        </p>
      )}

      {/* honeypot */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-2xl mb-2">The business</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" name="business_name" error={err.business_name}>
            <input id="business_name" name="business_name" required className={inputCls} />
          </Field>
          <Field label="What kind of work" name="industry" error={err.industry}>
            <select id="industry" name="industry" className={inputCls}>
              {INDUSTRIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </Field>
          <Field label="Street address" name="street" error={err.street}>
            <input id="street" name="street" required className={inputCls} />
          </Field>
          <Field label="City" name="city" error={err.city}>
            <input id="city" name="city" required className={inputCls} />
          </Field>
          <Field label="State" name="region" error={err.region}>
            <input id="region" name="region" defaultValue="CA" maxLength={2} required className={inputCls} />
          </Field>
          <Field label="ZIP" name="postal" error={err.postal}>
            <input id="postal" name="postal" required inputMode="numeric" className={inputCls} />
          </Field>
          <Field label="Business phone" name="phone" error={err.phone}>
            <input id="phone" name="phone" type="tel" required className={inputCls} />
          </Field>
          <Field label="Your email" name="email" error={err.email}>
            <input id="email" name="email" type="email" required className={inputCls} />
          </Field>
        </div>
        <Field label="Towns you serve (comma-separated)" name="service_area" error={err.service_area}>
          <input id="service_area" name="service_area" required placeholder="Victorville, Apple Valley, Hesperia" className={inputCls} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Instagram (optional)" name="instagram" error={err.instagram}>
            <input id="instagram" name="instagram" placeholder="@yourshop" className={inputCls} />
          </Field>
          <Field label="Facebook page (optional)" name="facebook" error={err.facebook}>
            <input id="facebook" name="facebook" className={inputCls} />
          </Field>
          <Field label="Google Maps link (optional)" name="google_maps_url" error={err.google_maps_url}>
            <input id="google_maps_url" name="google_maps_url" className={inputCls} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-display text-2xl mb-2">Hours</legend>
        {DAYS.map(([key, label]) => (
          <div key={key} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="w-24 font-semibold">{label}</span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name={`hours_${key}_closed`} defaultChecked={key === "sun"} />
              Closed
            </label>
            <input type="time" name={`hours_${key}_open`} defaultValue="08:00" aria-label={`${label} opening time`} className={inputCls} />
            <span aria-hidden="true">–</span>
            <input type="time" name={`hours_${key}_close`} defaultValue="17:00" aria-label={`${label} closing time`} className={inputCls} />
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-display text-2xl mb-2">Services</legend>
        <p className="text-sm text-ink-muted">Name each service, plus one line on what it is. These become your site&apos;s service pages.</p>
        {services.map((id, i) => (
          <div key={id} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input name="service_name" placeholder={`Service ${i + 1} name`} required={i === 0} aria-label={`Service ${i + 1} name`} className={inputCls} />
            <input name="service_blurb" placeholder="One-line description" aria-label={`Service ${i + 1} description`} className={inputCls} />
            {services.length > 1 ? (
              <button
                type="button"
                onClick={() => setServices(services.filter((s) => s !== id))}
                className="rounded border border-edge px-3 text-sm text-ink-muted"
                aria-label={`Remove service ${i + 1}`}
              >
                Remove
              </button>
            ) : <span />}
          </div>
        ))}
        {services.length < 12 && (
          <button
            type="button"
            onClick={() => { setServices([...services, nextId]); setNextId(nextId + 1); }}
            className="self-start rounded border border-edge px-4 py-2 text-sm font-semibold"
          >
            + Add another service
          </button>
        )}
        {err.services ? <p className="text-sm text-accent">{err.services}</p> : null}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-2xl mb-2">Your mark &amp; photos</legend>
        <Field label="Logo, business card, or any brand asset (JPEG/PNG/WebP)" name="logo">
          <input id="logo" name="logo" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" />
        </Field>
        <Field label="Photos of your work (up to 6)" name="photos">
          <input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="text-sm" />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-display text-2xl mb-2">In your own words</legend>
        <Field label="What makes your shop different? Write it like you'd say it." name="voice" error={err.voice}>
          <textarea id="voice" name="voice" rows={5} required className={inputCls}
            placeholder="We've been doing this 15 years. No sales guys — you talk to the person doing the work..." />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-2xl mb-2">Your domain</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Do you already have a domain?" name="existing_domain" error={err.existing_domain}>
            <input id="existing_domain" name="existing_domain" placeholder="yourshop.com (leave blank if none)" className={inputCls} />
          </Field>
          <Field label="Where is it registered?" name="registrar" error={err.registrar}>
            <select id="registrar" name="registrar" className={inputCls}>
              {REGISTRARS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-sm text-ink-muted">
          Just the name of the company — we never ask for your registrar login. Your domain stays
          yours, always.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-display text-2xl mb-2">Add-ons</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ADDONS.map(([key, label, blurb]) => (
            <label key={key} className="flex items-start gap-2 rounded border border-edge p-3 text-sm">
              <input type="checkbox" name="addons" value={key} className="mt-0.5" />
              <span><span className="font-semibold">{label}</span><br /><span className="text-ink-muted">{blurb}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-display text-2xl mb-2">Consent</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent_terms" required className="mt-0.5" />
          <span>
            I agree to the Curbside Sites terms of service and authorize Curbside Sites to build
            and host a website for my business. <span className="text-ink-muted">(required)</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded border border-edge bg-surface-raised p-3 text-sm">
          <input type="checkbox" name="consent_recording" className="mt-0.5" />
          <span>
            <span className="font-semibold">Optional — recording my kickoff call.</span> I agree
            that my onboarding call will be <strong>recorded and transcribed</strong>; that the
            recording and transcript will be processed by <strong>Anthropic</strong> (an AI
            service) and used to generate marketing content in my business&apos;s voice for the
            life of my account; that they are retained while my account is active; and that I can
            withdraw this consent at any time (email hello@curbsidesites.com or ask in my portal),
            which deletes the recording and the transcript. If I skip this, the call simply isn&apos;t
            recorded — notes only.
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-brand px-8 py-3 text-lg font-semibold text-on-brand disabled:opacity-60"
      >
        {pending ? "Building your draft…" : "Start my site"}
      </button>
    </form>
  );
}
