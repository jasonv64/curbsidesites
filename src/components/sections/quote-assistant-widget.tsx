"use client";

/**
 * AI quote assistant — STUB widget (D19 price list). Posts to
 * /api/quote-assistant; demo mode returns canned, clearly-labeled ballparks.
 */
import { useRef, useState } from "react";

interface Turn {
  who: "you" | "shop";
  text: string;
}

export function QuoteAssistantWidget({ heading }: { heading: string }) {
  const [turns, setTurns] = useState<Turn[]>([
    { who: "shop", text: "Describe the job — vehicle or boat, what you want done — and I'll give you a ballpark." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setTurns((t) => [...t, { who: "you", text: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/quote-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as { reply?: string };
      setTurns((t) => [
        ...t,
        { who: "shop", text: data.reply ?? "Something hiccuped — give us a call instead." },
      ]);
    } catch {
      setTurns((t) => [...t, { who: "shop", text: "Something hiccuped — give us a call instead." }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => logRef.current?.scrollTo({ top: 9e6 }));
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div className="border-2 border-edge">
        <h2 className="font-display border-b-2 border-edge bg-surface-raised px-5 py-4 text-2xl text-ink">
          {heading}
        </h2>
        <div ref={logRef} className="max-h-72 space-y-3 overflow-y-auto p-5" aria-live="polite">
          {turns.map((t, i) => (
            <p
              key={i}
              className={
                t.who === "you"
                  ? "ml-auto max-w-[85%] bg-brand px-4 py-2.5 text-sm text-on-brand"
                  : "max-w-[85%] bg-surface-raised px-4 py-2.5 text-sm text-ink"
              }
            >
              {t.text}
            </p>
          ))}
        </div>
        <form onSubmit={send} className="flex gap-2 border-t-2 border-edge p-4">
          <label htmlFor="qa-input" className="sr-only">
            Describe the job
          </label>
          <input
            id="qa-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 3-inch lift on a 2021 Tacoma"
            className="w-full border-2 border-edge bg-surface px-3 py-2.5 text-ink placeholder:text-ink-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 bg-accent px-5 py-2.5 font-bold text-on-accent disabled:opacity-50"
          >
            {busy ? "…" : "Ask"}
          </button>
        </form>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Ballparks only — final quotes always come from a human at the shop.
      </p>
    </section>
  );
}
