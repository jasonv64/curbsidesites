import { notFound } from "next/navigation";

/**
 * Never reached in practice — the proxy rewrites every request into
 * /s/[host]/... — but if it ever renders (misconfigured matcher), behave
 * like an unknown host: clean 404.
 */
export default function RootPage() {
  notFound();
}
