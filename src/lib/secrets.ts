/**
 * Secret resolution (Invariant 3: Key Vault or it doesn't exist).
 *
 * Adapters never read process.env for tenant secrets directly — they hold a
 * kv_secret_ref NAME from the integrations row and resolve it here. No code
 * path may ever RETURN a secret value to a caller that renders, logs, or
 * serializes it. /api/status reports names and whether they resolve — never
 * values.
 *
 * Providers:
 *   env      — local dev. Reads SECRET_<ref> from .env.local.
 *   keyvault — Azure Key Vault via DefaultAzureCredential (managed identity on
 *              Container Apps, `az login` on a laptop). Needs
 *              AZURE_KEY_VAULT_NAME; missing it throws loudly rather than
 *              silently serving demo (D11: half-configured is worse than
 *              unconfigured). Provisioned by RUNBOOK.md Phase 3.
 */

export interface SecretProvider {
  /** Returns the secret value, or null when the ref is not populated. */
  get(ref: string): Promise<string | null>;
}

const envProvider: SecretProvider = {
  async get(ref) {
    const v = process.env[`SECRET_${ref}`];
    return v && v.length > 0 ? v : null;
  },
};

// Values cached briefly so adapters resolving per call don't pay a vault
// round-trip each time; rotation still lands within KV_CACHE_MS with no deploy.
const KV_CACHE_MS = 5 * 60_000;
const KV_NEGATIVE_CACHE_MS = 60_000;
const kvCache = new Map<string, { value: string | null; at: number }>();
// SDK client held lazily so `env` mode never loads the Azure SDKs.
let kvClient: import("@azure/keyvault-secrets").SecretClient | null = null;

const keyVaultProvider: SecretProvider = {
  async get(ref) {
    const cached = kvCache.get(ref);
    if (cached && Date.now() - cached.at < (cached.value === null ? KV_NEGATIVE_CACHE_MS : KV_CACHE_MS)) {
      return cached.value;
    }
    if (!kvClient) {
      const name = process.env.AZURE_KEY_VAULT_NAME;
      if (!name) {
        throw new Error(
          "SECRET_PROVIDER=keyvault but AZURE_KEY_VAULT_NAME is not set. " +
            "Half-configured is worse than unconfigured (D11) — set it, or run with SECRET_PROVIDER=env."
        );
      }
      const [{ SecretClient }, { DefaultAzureCredential }] = await Promise.all([
        import("@azure/keyvault-secrets"),
        import("@azure/identity"),
      ]);
      kvClient = new SecretClient(`https://${name}.vault.azure.net`, new DefaultAzureCredential());
    }
    try {
      const secret = await kvClient.getSecret(ref);
      const value = secret.value && secret.value.length > 0 ? secret.value : null;
      kvCache.set(ref, { value, at: Date.now() });
      return value;
    } catch (e) {
      // Absent secret = unpopulated (normal: /api/status shows the gap).
      // Anything else (auth, network) is a real failure — rethrow so live
      // adapters run their demo-fallback path and stamp last_error_at.
      if ((e as { statusCode?: number }).statusCode === 404) {
        kvCache.set(ref, { value: null, at: Date.now() });
        return null;
      }
      console.error(`[secrets] Key Vault read failed for ref name '${ref}': ${(e as Error).message}`);
      throw e;
    }
  },
};

export function secretProvider(): SecretProvider {
  const which = process.env.SECRET_PROVIDER ?? "env";
  if (which === "keyvault") return keyVaultProvider;
  if (which === "env") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_ENV_SECRETS !== "1") {
      // next start locally IS NODE_ENV=production; the escape hatch is for
      // local prod-mode verification, set in .env.local, never in real infra.
      console.warn(
        "[secrets] env provider in production mode — fine locally, forbidden in real infra (Invariant 3)"
      );
    }
    return envProvider;
  }
  throw new Error(`Unknown SECRET_PROVIDER: ${which}`);
}

/** True if the ref resolves to a non-empty value. Used by /api/status. */
export async function secretPopulated(ref: string | null): Promise<boolean> {
  if (!ref) return false;
  try {
    return (await secretProvider().get(ref)) !== null;
  } catch {
    return false;
  }
}
