import { platformQuery, withTenant } from "@/lib/db";
import { secretPopulated } from "@/lib/secrets";
import type { IntegrationRow } from "@/lib/schemas";

/**
 * GET /api/status — the go-live checklist (Part 7). Staff-authenticated.
 * Per tenant, per integration: mode, config presence, the NAME of the
 * required secret and whether it resolves, last_error_at. NEVER a secret
 * value (Invariant 3) — this endpoint reports names and booleans only.
 *
 * Auth: Bearer STAFF_STATUS_TOKEN — kept as the machine-friendly surface for
 * CI and scripts now that real staff auth (Session 2, D16) guards the human
 * dashboard at admin.<apex>. The dashboard reads the same rows.
 */
export async function GET(req: Request) {
  const token = process.env.STAFF_STATUS_TOKEN;
  const auth = req.headers.get("authorization");
  if (!token || auth !== `Bearer ${token}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenants = await platformQuery<{ id: string; slug: string; status: string; plan_tier: string }>(
    "SELECT id, slug, status, plan_tier FROM tenants ORDER BY slug"
  );

  const fleet = [];
  for (const tenant of tenants) {
    const integrations = await withTenant(tenant.id, (db) =>
      db.query<IntegrationRow>(
        "SELECT key, mode, config, kv_secret_ref, key_owner, last_error_at, last_error FROM integrations ORDER BY key"
      )
    );
    fleet.push({
      tenant: tenant.slug,
      status: tenant.status,
      plan_tier: tenant.plan_tier,
      integrations: await Promise.all(
        integrations.map(async (i) => ({
          key: i.key,
          mode: i.mode,
          key_owner: i.key_owner,
          config_keys: Object.keys(i.config ?? {}),
          secret_ref: i.kv_secret_ref, // the NAME — never the value
          secret_populated: await secretPopulated(i.kv_secret_ref),
          last_error_at: i.last_error_at,
          last_error: i.last_error,
        }))
      ),
    });
  }

  return Response.json({ generated_at: new Date().toISOString(), fleet });
}
