/**
 * Adapter selection — the D11 state machine, in one place.
 *
 *   integration row missing or mode='demo'  → demo (unconfigured is normal)
 *   mode='live' + config/secret complete    → live
 *   mode='live' + config/secret MISSING     → THROW, naming the fix
 *       (half-configured is worse than unconfigured: the operator believes
 *        the feature is live and it silently isn't)
 *   live impl throws at runtime             → demo + console.error +
 *                                             last_error_at on the row
 *       (demo is the failure mode; a dead API never breaks a page)
 */
import { withTenant } from "@/lib/db";
import { secretProvider } from "@/lib/secrets";
import type { TenantBundle } from "@/lib/tenant";

export interface IntegrationState {
  key: string;
  mode: "live" | "demo";
  config: Record<string, string>;
  kv_secret_ref: string | null;
}

export function integrationFor(
  bundle: Pick<TenantBundle, "integrations">,
  key: string
): IntegrationState | null {
  const row = bundle.integrations.find((i) => i.key === key);
  return (row as IntegrationState | undefined) ?? null;
}

export class HalfConfiguredError extends Error {
  constructor(tenantSlug: string, key: string, missing: string, fixAt: string) {
    super(
      `Integration '${key}' on tenant '${tenantSlug}' is flagged LIVE but ${missing}. ` +
        `Refusing to silently serve demo (D11). Fix at: ${fixAt}`
    );
    this.name = "HalfConfiguredError";
  }
}

export interface LiveContext {
  /** Resolved secret value. NEVER return this to a renderable surface. */
  secret: string | null;
  config: Record<string, string>;
}

/**
 * Decide live vs demo for one integration on one tenant.
 * `requiredConfig` lists config keys live.ts needs; `secretRequired` says
 * whether kv_secret_ref must be populated for live mode.
 */
export async function selectMode(opts: {
  tenantSlug: string;
  key: string;
  integration: IntegrationState | null;
  requiredConfig?: string[];
  secretRequired?: boolean;
  fixAt: string;
}): Promise<{ mode: "demo" } | ({ mode: "live" } & LiveContext)> {
  const { integration, tenantSlug, key } = opts;
  if (!integration || integration.mode === "demo") return { mode: "demo" };

  for (const c of opts.requiredConfig ?? []) {
    if (!integration.config?.[c]) {
      throw new HalfConfiguredError(tenantSlug, key, `config '${c}' is missing`, opts.fixAt);
    }
  }
  let secret: string | null = null;
  if (opts.secretRequired) {
    if (!integration.kv_secret_ref) {
      throw new HalfConfiguredError(tenantSlug, key, "kv_secret_ref is not set", opts.fixAt);
    }
    secret = await secretProvider().get(integration.kv_secret_ref);
    if (secret === null) {
      throw new HalfConfiguredError(
        tenantSlug,
        key,
        `secret '${integration.kv_secret_ref}' is not populated`,
        opts.fixAt
      );
    }
  }
  return { mode: "live", secret, config: integration.config ?? {} };
}

/**
 * Run a live call with the demo fallback wrapped around it (D11). On error:
 * one console.error, last_error_at recorded, demo result returned. The page
 * never sees the failure.
 */
export async function guarded<T>(opts: {
  tenantId: string;
  key: string;
  live: () => Promise<T>;
  demo: () => Promise<T>;
}): Promise<{ result: T; served: "live" | "demo" }> {
  try {
    return { result: await opts.live(), served: "live" };
  } catch (e) {
    console.error(
      `[adapter:${opts.key}] live call failed; serving demo (D11 failure mode):`,
      e instanceof Error ? e.message : e
    );
    try {
      await withTenant(opts.tenantId, (db) =>
        db.query(
          "UPDATE integrations SET last_error_at = now(), last_error = $2 WHERE tenant_id = $1 AND key = $3",
          [opts.tenantId, e instanceof Error ? e.message.slice(0, 500) : String(e), opts.key]
        )
      );
    } catch {
      /* recording the error must never be the thing that breaks the page */
    }
    return { result: await opts.demo(), served: "demo" };
  }
}
