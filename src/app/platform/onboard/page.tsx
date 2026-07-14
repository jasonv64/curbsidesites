import type { Metadata } from "next";
import { IntakeForm } from "./intake-form";

export const metadata: Metadata = { title: "Start your site" };

/**
 * The one public control-plane surface (Part 1). The form's output is
 * database rows — a submission produces a browsable draft tenant with zero
 * human involvement (Part 2.1, Verify 12.2).
 */
export default function OnboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-4xl">Tell us about your business.</h1>
        <p className="mt-2 max-w-prose text-ink-muted">
          Fifteen minutes here and your draft site starts building itself — you&apos;ll get a
          private preview link the moment you hit submit, plus a 30-minute kickoff call with a
          real person.
        </p>
      </div>
      <IntakeForm />
    </div>
  );
}
