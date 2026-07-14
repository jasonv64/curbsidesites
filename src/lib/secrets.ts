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
 *   keyvault — Azure Key Vault via managed identity. Provisioned in Session 4
 *              (RUNBOOK.md); selecting it before then throws loudly rather
 *              than silently serving demo (D11: half-configured is worse than
 *              unconfigured).
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

const keyVaultProvider: SecretProvider = {
  async get(ref) {
    throw new Error(
      `KeyVaultSecretProvider is not wired yet (ref: ${ref}). ` +
        "This ships in Session 4 (RUNBOOK.md). Edit src/lib/secrets.ts → keyVaultProvider.get " +
        "to use @azure/keyvault-secrets + DefaultAzureCredential. Until then run with SECRET_PROVIDER=env."
    );
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
