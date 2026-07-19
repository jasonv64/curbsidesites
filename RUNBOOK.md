# RUNBOOK.md — local Docker Postgres → first three live demo tenants on real infrastructure

Written for one person, alone, at a laptop, over a weekend, who has never
provisioned any of these services. Competence assumed; familiarity not.

**Read this page, then Phase 0, before running anything.**

- **[YOU]** marks steps only a human can do — create accounts, click
  verification links, look at a photo, approve a palette.
- **[RUN]** marks steps that are a command. Commands are **PowerShell**
  (this project's home is a Windows laptop). Substitutable values are
  `$Variables` defined in Phase 0 — set them once per terminal session.
- Every phase starts with **Requires** (what must already be true) and ends
  with **You should now be able to ___** — a checkable state, not a hope.
  **Do not start a phase until the previous phase's check passed.**
- ⚠️ marks a step that can destroy something irreversible or half-succeed
  silently. The warning comes *before* the step.
- Real-world waits (Twilio review, Stripe verification, DNS, GBP) live in
  `CALENDAR.md`. **Read it first and start its day-one items today** — none 
  of them block Phase 1, and all of them block going live for real clients.
- What everything costs, at 3 / 50 / 200 tenants: `COSTS.md`.

**The shape of the thing you're building:**

```
visitor → Cloudflare (DNS, TLS, WAF)
        → edge Worker  (route */*: forwards real hostname in X-Forwarded-Host;
        |               serves static snapshot from Blob if origin is down — D6)
        → Azure Container Apps  (the Next.js app, west US 3)
        → Azure Database for PostgreSQL Flexible Server  (same region, RLS)
   secrets: Azure Key Vault, read via managed identity (Invariant 3)
   images + snapshots: Azure Blob Storage
   client domains: Cloudflare for SaaS Custom Hostnames (D15)
   billing: Stripe Billing (D7) · email: Resend (ASSUMPTIONS #1)
```

Phase order = dependency order: **1** Azure foundation → **2** database →
**3** Key Vault → **4** Blob → **5** the app → **6** Cloudflare + domains →
**7** static failover → **8** email → **9** Stripe → **10** the three demo
tenants → **11** monitoring + rollback.

**As built (2026-07-18) — where the live deployment differs from this page.**
The commands below are still the recipe; these are the values and choices that
actually shipped. Read this before copying any `$Variable` verbatim.

| This page says | Actually deployed | Why |
|---|---|---|
| PowerShell on Windows | **zsh on macOS** | Translate `Invoke-RestMethod`→`curl`, `` ` ``→`\`, `Select-String`→`grep`, `Out-File`→heredoc |
| `curbside-prod`, `curbside-app`, … | **`-01` suffix on every name** (`curbside-prod-01`, `curbside-app-01`, `curbsideconreg01`) | Chosen at provisioning |
| Postgres **16** | **Postgres 18** | Local `docker-compose.yml` moved to 18 to match. ⚠️ The 18 image stores data in a major-version subdirectory — the volume mounts at `/var/lib/postgresql`, **not** `/var/lib/postgresql/data`, or the container won't start |
| admin user `curbside_admin` | **`curbsidepgadmin01`** | The connection strings must match |
| Storage `Standard_LRS` | **`Standard_RAGRS`** | Portal default, kept; ~$10–15/mo above COSTS.md. Reversible with `az storage account update --sku Standard_LRS` |
| `--max-replicas 3` | **`--max-replicas 1`** | Per-instance ISR cache — see the note in 5.2 |
| Phase 9 (Stripe) | **deferred** | Not needed to put demos on the internet |
| A freshly-bought domain with no mail | **GoDaddy NS + live Microsoft 365 mail** | ⚠️ The Phase 6 nameserver swap will take mail down unless you do **6.1a** first |

Session variables live in `~/.curbside-env-01` (`chmod 600`, outside the repo
so `az acr build` can't upload it), sourced per terminal. It exports both the
descriptive names and the short `$RG`/`$PG`/`$ST` aliases this page uses, plus
`$ACR_LOGIN_SERVER` and `$APP_FQDN`. **Never source it in a shell where you run
`npm run dev`** — `DATABASE_URL` would point local dev at production.

---

## PHASE 0 — Names, tools, and the terminal

**Requires:** a Windows laptop with this repo, Docker (you have it), Node 20.9+.

### 0.1 [YOU] Pick your names once

Azure names below must be **globally unique** where marked. Decide now;
several (storage account especially) are painful-to-impossible to rename.

### 0.2 [RUN] Set the session variables

Paste into every new PowerShell you open for this runbook (keep a copy in a
password manager — **not** in the repo):

```powershell
$RG   = "curbside-prod"          # resource group
$LOC  = "westus3"                # region — see 1.2 for why
$PG   = "curbside-pg-01"         # Postgres server  (globally unique)
$KV   = "curbside-kv-01"         # Key Vault        (globally unique, 3-24 chars)
$ST   = "curbsidestor01"         # storage account  (globally unique, 3-24, lowercase+digits ONLY)
$ACR  = "curbsideacr01"          # container registry (globally unique, alphanumeric)
$ACAENV = "curbside-env"         # Container Apps environment
$APP  = "curbside-app"           # the web app
$APEX = "curbsidesites.com"      # the zone you'll buy in Phase 6
$PLATFORM_APEX = "sites.$APEX"   # platform subdomains live under this
```

Passwords — generate three now, save them in the password manager. Stick to
letters/digits (they travel inside connection-string URLs; `@ : / #` would
need URL-encoding and will bite you):

```powershell
node -e "for (const n of ['PG ADMIN','APP ROLE','CONTROL ROLE']) console.log(n, require('crypto').randomBytes(24).toString('base64url').replace(/[-_]/g,'x'))"
$PGPW  = "<PG ADMIN value>"; $APPPW = "<APP ROLE value>"; $CTLPW = "<CONTROL ROLE value>"
```

### 0.3 [RUN] Install the CLI tools

```powershell
winget install Microsoft.AzureCLI
npm install    # you already did this if the repo verifies locally
```

Close and reopen the terminal, re-paste 0.2, then:

```powershell
az version     # any 2.60+ is fine
```

**You should now be able to** run `az version` and recite where your three
passwords are stored.

---

## PHASE 1 — Azure subscription and resource group

**Requires:** Phase 0.

### 1.1 [YOU] Create the Azure subscription

portal.azure.com → sign in with a Microsoft account (use the business email
you'll keep) → Start with pay-as-you-go. You'll need a credit card. Skip
"free trial" credits if offered with limits that block paid SKUs; otherwise
take them — everything here runs fine on the free-trial credit.

### 1.2 Why `westus3`, and why the DB and app must share it

Every tenant page render is **several sequential Postgres queries** (tenant
row fresh every request + the bundle on cache miss). Put the app 30 ms from
its database and you add 30 ms × N queries to every uncached render —
co-location isn't a preference, it's the page-speed budget (and Core Web
Vitals are a ranking input, Invariant 9's cousin). `westus3` (Phoenix) is
the closest *modern* Azure region to Southern California clients: it has
availability zones and current SKUs. `westus` (California) is older,
frequently capacity-constrained, and has no zones; `westus2` (Washington)
is fine but farther and typically no cheaper. Both the Postgres server and
the Container Apps environment go in `$LOC` — that is the co-location rule.

### 1.3 [RUN] Log in, create the resource group

```powershell
az login
az group create --name $RG --location $LOC
```

**You should now be able to** see `curbside-prod` under Resource groups in
the portal.

---

## PHASE 2 — PostgreSQL Flexible Server (D3, D4)

**Requires:** Phase 1. The local app runs (so you know migrations are good).

### 2.1 [RUN] Provision the server

Takes ~5–10 minutes.

```powershell
$MYIP = (Invoke-RestMethod https://api.ipify.org)
az postgres flexible-server create --resource-group $RG --name $PG --location $LOC `
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 18 `
  --admin-user curbside_admin --admin-password $PGPW `
  --public-access $MYIP --yes
az postgres flexible-server db create --resource-group $RG --server-name $PG --name curbside
```

⚠️ Azure blocks Postgres extensions by default, and `001_init.sql` needs
`pgcrypto`. Allowlist it now or 2.3 fails partway with error `0A000` — after
`ensureRole` has already created the two roles, which is what makes the retry
fail differently the second time:

```powershell
az postgres flexible-server parameter set --resource-group $RG --server-name $PG `
  --name azure.extensions --value pgcrypto
```

Why these choices: **B1ms** (1 vCPU / 2 GiB) is genuinely enough for 3
tenants and costs ~$13/mo — `COSTS.md` says when to move to B2s. **Postgres
18** matches the local container exactly (`docker-compose.yml`) — keep the two
in lockstep whichever version you pick. **Public access + firewall** (not
VNet injection) is the deliberate v1 network model: a solo operator gets a
debuggable database and loses nothing that matters yet; the VNet upgrade
path is noted in COSTS.md at the 50-tenant mark.

### 2.2 [RUN] Let Azure services (the app, later) reach it

```powershell
az postgres flexible-server firewall-rule create --resource-group $RG --name $PG `
  --rule-name allow-azure-services --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

The `0.0.0.0–0.0.0.0` rule is Azure's magic value for "resources inside
Azure" — coarse, and the accepted v1 trade (the roles still need passwords,
TLS is required, and RLS holds inside). Tighten to VNet integration when
COSTS.md says so.

### 2.3 [RUN] Point the repo's tooling at the real server, migrate

⚠️ From here on, `.env.production.local` on your laptop holds real
credentials. It is already gitignored (`.env*`); never commit it, never
echo it into a chat or a screenshot.

Create `.env.production.local` **outside** the app's runtime (used only by
laptop tooling — migrations, seeds, tests):

```powershell
@"
DATABASE_URL=postgres://curbside_app:$APPPW@$PG.postgres.database.azure.com:5432/curbside?sslmode=require
DATABASE_URL_OWNER=postgres://curbside_admin:$PGPW@$PG.postgres.database.azure.com:5432/curbside?sslmode=require
DATABASE_URL_CONTROL=postgres://curbside_control:$CTLPW@$PG.postgres.database.azure.com:5432/curbside?sslmode=require
"@ | Out-File -Encoding utf8 .env.production.local
```

Then run migrations against it (the runner also creates the two
NOBYPASSRLS roles with these passwords):

```powershell
$env:DATABASE_URL_OWNER = "postgres://curbside_admin:$PGPW@$PG.postgres.database.azure.com:5432/curbside?sslmode=require"
$env:APP_DB_PASSWORD = $APPPW
$env:CONTROL_DB_PASSWORD = $CTLPW
npm run db:migrate
```

Half-success to watch for: if this hangs then times out, it's the firewall
(your IP changed — rerun 2.1's firewall line with the new `$MYIP`; note the
`list` subcommand wants `--server-name`, not `-n`). If it fails with a
certificate error, your corporate network is intercepting TLS; hotspot
around it.

On Azure specifically, the migration runner **only declares** `NOSUPERUSER` /
`NOBYPASSRLS` when it *creates* a role — Azure's admin is not a true
superuser, and only a superuser may change those attributes, even to "NO".
Re-runs therefore rotate the password and then *assert* the attributes rather
than re-setting them; a role that somehow has `rolsuper` or `rolbypassrls`
aborts the migration instead of silently proceeding. Nothing to do here —
just don't "fix" that back into a single `CREATE`/`ALTER` statement.

### 2.4 [RUN] Seed the two polished demo tenants + your staff login

Iron Ridge Offroad and Delta Marine are **sales assets** — they belong in
production. (`SKIP_IMAGE_SOURCING=1` because image URLs get moved to Blob
properly in Phase 10.3 — locally-sourced file paths would 404 in the cloud.)

```powershell
$env:SKIP_IMAGE_SOURCING = "1"
npm run db:seed
$env:STAFF_ADMIN_PASSWORD = ""   # leave empty to have one generated + printed ONCE
npm run staff:create -- valadezj045@gmail.com "Jason"
```

⚠️ `staff:create`, **not** `db:seed:fleet` — the fleet seed drags four fake
tenants in mixed states into what is now your production database.

### 2.5 [RUN] Prove RLS against the real database — not just locally

This is D4, the highest-severity risk in the platform, now running against
the actual server that will hold real businesses' leads:

```powershell
$env:DATABASE_URL = "postgres://curbside_app:$APPPW@$PG.postgres.database.azure.com:5432/curbside?sslmode=require"
npm run test:rls
```

All tests must pass. If any fail, **stop the runbook** — nothing after this
matters until it's green.

**You should now be able to** run `npm run test:rls` green against
`$PG.postgres.database.azure.com` and log in to nothing yet (the app doesn't
exist in the cloud — correct).

---

## PHASE 3 — Key Vault (Invariant 3)

**Requires:** Phase 1.

### 3.1 [RUN] Create the vault (RBAC mode) and grant yourself data access

```powershell
az keyvault create --resource-group $RG --name $KV --location $LOC --enable-rbac-authorization true
$ME = az ad signed-in-user show --query id -o tsv
$KVID = az keyvault show --name $KV --query id -o tsv
az role assignment create --assignee $ME --role "Key Vault Secrets Officer" --scope $KVID
```

Half-success to watch for: being subscription Owner does **not** grant
data-plane access in RBAC mode. Without that role assignment, every
`az keyvault secret set` below fails with `Forbidden` and it looks like a
CLI bug. Role assignments can also take **up to ~10 minutes** to propagate
— if the first `secret set` 403s, wait, don't debug.

### 3.2 [RUN] Seed the first secrets

Infrastructure secrets (the app reads these as Container Apps
secret-references in Phase 5):

```powershell
$STATUS_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
$TOTP_KEY     = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
$CRON_TOKEN   = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

az keyvault secret set --vault-name $KV --name curbside-app-database-url `
  --value "postgres://curbside_app:$APPPW@$PG.postgres.database.azure.com:5432/curbside?sslmode=require"
az keyvault secret set --vault-name $KV --name curbside-control-database-url `
  --value "postgres://curbside_control:$CTLPW@$PG.postgres.database.azure.com:5432/curbside?sslmode=require"
az keyvault secret set --vault-name $KV --name staff-status-token --value $STATUS_TOKEN
az keyvault secret set --vault-name $KV --name staff-totp-enc-key --value $TOTP_KEY
az keyvault secret set --vault-name $KV --name cron-token --value $CRON_TOKEN
```

Integration secrets (the app resolves these itself by `kv_secret_ref` —
SECRETS.md is the full manifest). Seed the one you certainly have:

```powershell
# [YOU] get the key at console.anthropic.com → API keys
az keyvault secret set --vault-name $KV --name curbside-anthropic-api-key --value "<paste>"
```

`curbside-resend-api-key` lands in Phase 8, `curbside-cloudflare-api-token`
in Phase 6, `curbside-stripe-webhook-secret` in Phase 9 — each phase seeds
its own.

The two proofs this phase owes ("the app can read one" and "no endpoint
returns a value") need a running app — they're **Phase 5.6**, deliberately.

**You should now be able to** run
`az keyvault secret list --vault-name $KV -o table` and see five names —
names, which is all anything is ever allowed to show you.

---

## PHASE 4 — Blob Storage

**Requires:** Phase 1.

### 4.1 [RUN] Account and containers

⚠️ The storage account name is permanent and becomes part of public image
URLs (`https://$ST.blob.core.windows.net/...`). Sure about the name? Then:

```powershell
az storage account create --resource-group $RG --name $ST --location $LOC `
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access true
az storage container create --account-name $ST --name tenant-images --public-access blob --auth-mode login
az storage container create --account-name $ST --name failover --public-access blob --auth-mode login
$STID = az storage account show --name $ST --resource-group $RG --query id -o tsv
az role assignment create --assignee $ME --role "Storage Blob Data Contributor" --scope $STID
```

Public read on both containers is deliberate: everything in them is public
by nature (site photos rendered on public pages; failover snapshots *are*
public pages). Nothing private ever lands in these containers — lead photo
uploads also render on the tenant's own portal only, but the files
themselves are addressed by unguessable UUIDs, which matches the v1 threat
model. Revisit with SAS tokens if a client ever uploads something sensitive.

If `container create` fails with `AuthorizationPermissionMismatch`, it's the
same ~10-minute RBAC propagation as 3.1.

### 4.2 [RUN] CORS

`next/image` fetches blobs **server-side** (no CORS involved), but the
gallery lightbox and any future client-side fetch need it. GET-only,
public-content containers, so a wildcard origin is fine:

```powershell
az storage cors add --account-name $ST --services b --methods GET HEAD `
  --origins "*" --allowed-headers "*" --exposed-headers "*" --max-age 3600
```

### 4.3 `next/image` remote patterns — already done

`next.config.ts` already allows `https://*.blob.core.windows.net/tenant-images/**`.
Nothing to edit. (This is the "Blob CORS" gotcha in README resolved: server
fetches need the remotePattern, browsers need 4.2.)

**You should now be able to** upload any test file with
`az storage blob upload --account-name $ST -c tenant-images -n test.txt -f README.md --auth-mode login`,
open `https://$ST.blob.core.windows.net/tenant-images/test.txt` in a
browser, then delete it
(`az storage blob delete --account-name $ST -c tenant-images -n test.txt --auth-mode login`).

---

## PHASE 5 — Container Apps: registry, build, deploy

**Requires:** Phases 2, 3, 4.

### 5.1 [RUN] Registry + first image build

The repo ships a `Dockerfile` (web app + cron scripts + chromium for report
PDFs, one deliberately fat image). `az acr build` builds **in the cloud** —
no local Docker involvement, and the build needs no database:

```powershell
az acr create --resource-group $RG --name $ACR --sku Basic
az acr build --registry $ACR --image curbside-app:v1 .
```

First build takes ~10 minutes (chromium). Tag every build (`v1`, `v2`, …) —
tags are your rollback vocabulary (Phase 11).

⚠️ **The login server is not always `$ACR.azurecr.io`.** Depending on the
registry's domain-name-label scope, Azure appends a hash
(`myacr-ab12cd34.azurecr.io`). Read the real value and use it everywhere
below — a wrong registry host is an image-pull failure at 5.2 and again in
7.3's export job:

```powershell
$ACRLOGIN = az acr show --name $ACR --query loginServer -o tsv
$ACRLOGIN   # ← use this, not "$ACR.azurecr.io"
```

### 5.2 [RUN] Environment + the app (it will crash-loop for a few minutes — expected)

A fresh pay-as-you-go subscription is registered for neither provider Container
Apps needs. Do this first — `env create` fails on the second one even after you
fix the first, and registration is a subscription-wide, one-time operation that
takes a few minutes to propagate:

```powershell
az provider register -n Microsoft.App --wait
az provider register -n Microsoft.OperationalInsights --wait     # ACA's default logging
az provider show -n Microsoft.App --query registrationState -o tsv              # → Registered
az provider show -n Microsoft.OperationalInsights --query registrationState -o tsv
```

```powershell
az containerapp env create --resource-group $RG --name $ACAENV --location $LOC

az containerapp create --resource-group $RG --name $APP --environment $ACAENV `
  --image "$ACRLOGIN/curbside-app:v1" `
  --registry-server "$ACRLOGIN" --registry-identity system `
  --ingress external --target-port 3000 `
  --min-replicas 1 --max-replicas 1 --cpu 1.0 --memory 2.0Gi `
  --system-assigned
```

`--max-replicas 1`: the app calls `revalidateTag()` when a tenant edits its
content, but Next's default ISR cache is **per-instance** and `next.config.ts`
sets no shared `cacheHandler`. At 2+ replicas one shop's edit invalidates only
the replica that served the request, and the client sees their old hours flap
back for up to 600s. Latent at demo traffic, and it bites exactly when a site
gets busy. Scaling out is a real decision that needs a shared cache handler
(Redis or Blob) — make it deliberately, don't inherit it from a default.

⚠️ **`az containerapp create` may silently ignore `--image`,
`--registry-server`, and `--registry-identity`** and deploy
`mcr.microsoft.com/k8se/quickstart:latest` instead — exit code 0, no warning.
The managed identity doesn't exist yet at create time, so it can't authenticate
to ACR, and it substitutes the placeholder rather than failing. The tell is a
startup probe that never passes (quickstart listens on `:80`, your ingress
targets `3000`), which is easy to mistake for the expected crash-loop below.
**Verify, then fix after 5.3 grants the roles:**

```powershell
az containerapp show -g $RG -n $APP --query "properties.template.containers[0].image" -o tsv
az containerapp show -g $RG -n $APP --query "properties.configuration.registries" -o json   # empty = it dropped them

# If either is wrong, re-apply once the identity has AcrPull (5.3):
az containerapp registry set -g $RG -n $APP --server "$ACRLOGIN" --identity system
az containerapp update -g $RG -n $APP --image "$ACRLOGIN/curbside-app:v1"
```

The app has no environment yet, so its first revision fails its own DB
queries. That's fine; we're creating it first because the **managed
identity** (the thing Key Vault trusts) only exists once the app does.

### 5.3 [RUN] Give the app's identity its two roles

```powershell
$PRINCIPAL = az containerapp show --resource-group $RG --name $APP --query identity.principalId -o tsv
$ACRID = az acr show --name $ACR --query id -o tsv
az role assignment create --assignee $PRINCIPAL --role "Key Vault Secrets User" --scope $KVID
az role assignment create --assignee $PRINCIPAL --role "Storage Blob Data Contributor" --scope $STID
az role assignment create --assignee $PRINCIPAL --role "AcrPull" --scope $ACRID
```

`AcrPull` is what makes `--registry-identity system` work. The CLI *sometimes*
creates it for you; when it doesn't, the failure looks nothing like the
expected crash-loop — you get an image-pull `UNAUTHORIZED` and no container at
all. The assignment is idempotent, so run it regardless.

`Key Vault Secrets User` is read-only — the app can resolve secrets, never
write or list-then-exfiltrate them via a compromised dependency with write
ambitions. Blob Contributor is for photo uploads.

### 5.4 [RUN] Secrets and environment

Container Apps secrets here are **references into Key Vault** — values
never sit in the app config, and rotating in KV rotates here.

```powershell
az containerapp secret set --resource-group $RG --name $APP --secrets `
  "database-url=keyvaultref:https://$KV.vault.azure.net/secrets/curbside-app-database-url,identityref:system" `
  "database-url-control=keyvaultref:https://$KV.vault.azure.net/secrets/curbside-control-database-url,identityref:system" `
  "staff-status-token=keyvaultref:https://$KV.vault.azure.net/secrets/staff-status-token,identityref:system" `
  "staff-totp-enc-key=keyvaultref:https://$KV.vault.azure.net/secrets/staff-totp-enc-key,identityref:system" `
  "cron-token=keyvaultref:https://$KV.vault.azure.net/secrets/cron-token,identityref:system"

az containerapp update --resource-group $RG --name $APP --set-env-vars `
  "DATABASE_URL=secretref:database-url" `
  "DATABASE_URL_CONTROL=secretref:database-url-control" `
  "STAFF_STATUS_TOKEN=secretref:staff-status-token" `
  "STAFF_TOTP_ENC_KEY=secretref:staff-totp-enc-key" `
  "CRON_TOKEN=secretref:cron-token" `
  "SECRET_PROVIDER=keyvault" `
  "AZURE_KEY_VAULT_NAME=$KV" `
  "AZURE_STORAGE_ACCOUNT=$ST" `
  "PLATFORM_APEX=$PLATFORM_APEX" `
  "TRUST_PROXY_HOST=1" `
  "CF_FALLBACK_ORIGIN=sites-origin.$APEX" `
  "PLATFORM_EMAIL_FROM=Curbside Sites <hello@$APEX>" `
  "STAFF_NOTIFY_EMAIL=valadezj045@gmail.com"
```

⚠️ Two half-success traps, both silent:

- **`SECRET_PROVIDER` unset or typo'd** → the app falls back to the env
  provider, finds nothing, and every integration quietly serves demo. The
  tell: `/api/status` shows *every* secret unpopulated. The code refuses to
  ship env-file secrets in production (`ALLOW_ENV_SECRETS` guard), but an
  unset provider is indistinguishable from "no secrets yet" — check
  deliberately in 5.6.
- **`TRUST_PROXY_HOST=1` is only safe behind the Worker.** It's set now
  (before Cloudflare exists) because the only hostname reaching ACA directly
  is its own FQDN, which resolves to no tenant. Never port this flag to any
  deployment where clients hit the app without a proxy that *overwrites*
  `X-Forwarded-Host`.

### 5.5 [RUN] Health probes

The app ships `/api/health` (checks the DB, answers on any hostname —
that's what probes send). Wire it in:

```powershell
az containerapp show --resource-group $RG --name $APP -o yaml > app.yaml
```

[YOU] Edit `app.yaml`: under `template:` → `containers:` → (the one
container), add:

```yaml
      probes:
      - type: Startup
        httpGet: { path: /api/health, port: 3000 }
        initialDelaySeconds: 5
        periodSeconds: 5
        failureThreshold: 30
      - type: Readiness
        httpGet: { path: /api/health, port: 3000 }
        periodSeconds: 10
        failureThreshold: 3
      - type: Liveness
        httpGet: { path: /api/health, port: 3000 }
        periodSeconds: 30
        failureThreshold: 5
```

```powershell
az containerapp update --resource-group $RG --name $APP --yaml app.yaml
Remove-Item app.yaml
```

### 5.6 [RUN] Verify — including the two proofs Phase 3 owed

```powershell
$FQDN = az containerapp show --resource-group $RG --name $APP --query properties.configuration.ingress.fqdn -o tsv
$FQDN   # ← write this down; the Worker (Phase 6) needs it

# 1. Health (also proves DB connectivity through the firewall rule):
Invoke-RestMethod "https://$FQDN/api/health"          # → ok: True

# 2. The app CAN read Key Vault.
#    ⚠️ /api/status enumerates ONLY per-tenant refs (tenant-<slug>-<key>).
#    `curbside-anthropic-api-key` is a PLATFORM ref and never appears here —
#    don't look for it. And every ref reading `populated:false` is ambiguous
#    by construction: secretPopulated() swallows all errors and returns false,
#    so "not seeded" and "provider broken" look identical.
$status = Invoke-RestMethod "https://$FQDN/api/status" -Headers @{ Authorization = "Bearer $STATUS_TOKEN" }
$status | ConvertTo-Json -Depth 6 | Select-String "populated"

#    Disambiguate from the logs instead — the code makes this decidable:
#      SECRET_PROVIDER unset  → env fallback, logs "env provider in production mode"
#      SECRET_PROVIDER typo'd → throws "Unknown SECRET_PROVIDER" (loud, not silent)
#      identity can't read KV → logs "Key Vault read failed" on EVERY ref
#      secret simply absent   → clean 404, logs nothing
#    So: hit /api/status (which resolves every ref), then confirm silence.
az containerapp logs show -g $RG -n $APP --tail 200 --type console |
  Select-String "env provider|Key Vault read failed|Unknown SECRET_PROVIDER"
# No matches + SECRET_PROVIDER=keyvault below = the managed identity really can
# read the vault, and the false flags are genuine "not seeded yet".
az containerapp show -g $RG -n $APP `
  --query "properties.template.containers[0].env[?name=='SECRET_PROVIDER'].value" -o tsv   # → keyvault

# 3. NO endpoint returns a secret VALUE — grep the actual response bytes
#    for the actual secret (CONTROL-PLANE Part 12.3 — responses, not code):
$anthropic = az keyvault secret show --vault-name $KV --name curbside-anthropic-api-key --query value -o tsv
$raw = (Invoke-WebRequest "https://$FQDN/api/status" -Headers @{ Authorization = "Bearer $STATUS_TOKEN" }).Content
if ($raw.Contains($anthropic)) { "LEAK — STOP" } else { "no value in response — good" }

# 4. Direct-to-ACA request is a clean 404 tenant-wise (unknown host), not an error:
(Invoke-WebRequest "https://$FQDN/" -SkipHttpErrorCheck).StatusCode   # → 404
```

**You should now be able to** hit `https://$FQDN/api/health` → `ok: true`,
see secret *names with populated flags* on `/api/status`, and prove the
secret *value* appears in no response.

---

## PHASE 6 — Cloudflare: the zone, the edge Worker, and client domains

**Requires:** Phase 5 (you need `$FQDN`).

### 6.1 [YOU] Buy curbsidesites.com and create the zone

1. Register `curbsidesites.com`. Cloudflare Registrar (dash.cloudflare.com →
   Domain Registration) is the simplest: at-cost pricing and the zone is
   created + nameservers set in one motion. Any registrar works; you'll just
   also do the nameserver swap.
2. If bought elsewhere: Cloudflare dash → Add site → Free plan → it shows
   two nameservers → set them at the registrar. Propagation: minutes to
   ~24 h (CALENDAR.md).
3. Note your **Zone ID** (dash → the domain → Overview, right column) and
   **Account ID** (same panel).

#### ⚠️ 6.1a — If the domain already carries live mail, do this FIRST

**As built:** `curbsidesites.com` is registered at GoDaddy (nameservers
`ns23/ns24.domaincontrol.com`) and already runs Microsoft 365 mail. The
nameserver swap in step 2 **replaces GoDaddy's entire zone with Cloudflare's**.
Anything not already recreated at Cloudflare stops resolving the moment the
swap propagates — and the first casualty is your own business email, silently,
with senders getting bounces you never see.

Cloudflare's "Add site" scan copies most records automatically, but it is
best-effort: it misses records it can't enumerate, and it does not know which
must stay unproxied. **Verify by hand before flipping.**

1. [YOU] At GoDaddy: export the zone file (DNS → Records → Export), or
   screenshot every record. Keep it until the migration is proven.
2. [RUN] Capture what's live right now, from outside:

```powershell
$D = "curbsidesites.com"
dig +short MX $D ; dig +short TXT $D ; dig +short CNAME autodiscover.$D
dig +short TXT _dmarc.$D ; dig +short CNAME selector1._domainkey.$D
```

3. [YOU] In Cloudflare, recreate every mail record **before** touching
   nameservers. All of these are **DNS-only (grey cloud)** — proxying an MX or
   an auth record breaks mail:

| Type | Name | Content | Cloud |
|---|---|---|---|
| MX | `@` | `curbsidesites-com.mail.protection.outlook.com` (pri 0) | grey |
| TXT | `@` | `v=spf1 include:spf.protection.outlook.com -all` | grey |
| TXT | `@` | `MS=…` (Microsoft's domain-verification token) | grey |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | grey |
| CNAME | `selector1._domainkey` / `selector2._domainkey` | per M365 (see below) | grey |
| TXT | `_dmarc` | see 8.1 — replace the registrar's default | grey |

4. [YOU] Flip the nameservers, then **re-run the `dig` block above** and confirm
   every answer is unchanged. Send yourself a test message both directions
   before moving on.

**Also enable DKIM in Microsoft 365** if you haven't — it is off by default
(Defender portal → Email & collaboration → Policies → Email authentication →
DKIM → enable for the domain, which publishes the two `selector*._domainkey`
CNAMEs). Without it, mail authenticates on SPF alignment alone and fails the
moment a message is forwarded.

### 6.2 [RUN] DNS records

Dash → DNS → Records (or API if you prefer). All **Proxied** (orange cloud):

| Type | Name | Content | Why |
|---|---|---|---|
| A | `sites` | `192.0.2.1` | originless — the Worker answers, never this IP |
| A | `*.sites` | `192.0.2.1` | every platform subdomain + admin.sites |
| AAAA | `sites-origin` | `100::` | Cloudflare-for-SaaS fallback origin (originless — Worker pattern per Cloudflare docs) |

⚠️ Half-success: a **grey-cloud** (DNS-only) record here means visitors go
straight to `192.0.2.1` — a black hole. Every record above must show the
orange cloud.

Also add (dash → Rules → Redirect Rules) a temporary redirect
`curbsidesites.com/* → https://sites.curbsidesites.com/$1` (301) so the bare
apex isn't a 404 before Session 5 builds the real marketing site.

### 6.3 [YOU] TLS for `*.sites.curbsidesites.com` — this one costs $10/mo and is not optional

Universal SSL covers `curbsidesites.com` and `*.curbsidesites.com` — **one
level only.** `iron-ridge-offroad.sites.curbsidesites.com` is two levels
deep and will throw TLS handshake errors (browser: `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`,
curl: error 525/526-ish) without an advanced certificate.

Dash → SSL/TLS → Edge Certificates → **Advanced Certificate Manager** ($10/mo)
→ order a certificate covering: `sites.curbsidesites.com`, `*.sites.curbsidesites.com`.
Issuance is usually minutes. **Wait for status "Active" before testing 6.5.**

Also set SSL/TLS mode to **Full (strict)** (dash → SSL/TLS → Overview) — the
Worker fetches the ACA origin over its real, valid certificate, so strict
costs nothing and prevents downgrade surprises.

### 6.4 [RUN] Deploy the edge Worker

The Worker source is in the repo: `infra/cloudflare/worker.js` (read its
header — it explains both jobs: host-forwarding and D6 failover).

[YOU] First edit `infra/cloudflare/wrangler.toml`: set `ORIGIN_HOST` to your
`$FQDN`, `SNAPSHOT_HOST` to `$ST.blob.core.windows.net`, and check
`ALERT_EMAIL`.

```powershell
cd infra/cloudflare
npx wrangler@latest login          # [YOU] browser OAuth
npx wrangler@latest deploy
# Optional but strongly recommended (failover alert emails, D6) — paste the
# Resend key when Phase 8 gives you one; re-run this then if you skip now:
npx wrangler@latest secret put RESEND_API_KEY
cd ../..
```

The route `*/*` catches **all** traffic entering the zone — platform
subdomains, the admin host, and (this is the load-bearing part) Cloudflare-
for-SaaS custom hostnames, i.e. client domains. One Worker fronts the fleet.

### 6.5 [RUN] Verify the platform surface end to end

```powershell
# The seeded demo tenant, through Cloudflare, TLS and all:
curl.exe -s https://iron-ridge-offroad.sites.curbsidesites.com/ | Select-String "760"   # Iron Ridge's area code / phone
curl.exe -s -o NUL -w "%{http_code}" https://delta-marine-service.sites.curbsidesites.com/   # 200
curl.exe -s -o NUL -w "%{http_code}" https://nonsense-slug.sites.curbsidesites.com/          # 404, clean
```

[YOU] Open `https://admin.sites.curbsidesites.com` → log in with the
Phase 2.4 credentials → **TOTP enrollment is forced now** — scan the QR into
your authenticator app. This is your production staff login; treat the
recovery of it accordingly (password manager).

### 6.6 Cloudflare for SaaS — client-owned domains (D15)

**Setup (once):**

1. [YOU] Dash → SSL/TLS → Custom Hostnames → **Enable Cloudflare for SaaS**
   (free for the first 100 hostnames, then ~$0.10/hostname/mo).
2. [YOU] Set **Fallback origin** = `sites-origin.curbsidesites.com` (the
   6.2 record). Wait for it to show "Active".
3. [YOU] Dash → My Profile → API Tokens → Create token → custom: Zone →
   `curbsidesites.com` → permissions **SSL and Certificates: Edit**. Copy it.
4. [RUN] Seed it + tell the app about the zone:

```powershell
az keyvault secret set --vault-name $KV --name curbside-cloudflare-api-token --value "<the token>"
az containerapp update --resource-group $RG --name $APP --set-env-vars "CLOUDFLARE_ZONE_ID=<your zone id>"
```

⚠️ The code throws loudly if the zone ID is set and the token secret isn't
(D11's half-configured rule) — set them in the order above and the window
is seconds. KV reads are cached ~5 min; give the app that long (or restart
the revision) before testing.

**The per-client flow (do it once now, end to end, with a test domain):**

You need a client-owned domain to prove this. [YOU] Use any spare domain you
own, or buy a $5 test domain at any registrar — its registrar dashboard is
the "client side" of this rehearsal.

1. [YOU] Admin → the tenant (use `iron-ridge-offroad`) → Domains → enter the
   test domain → Provision. This calls the Custom Hostnames API and emails
   **registrar-specific instructions** to the tenant's owner email — for a
   real client that's all you send: that one generated email. It contains:
   - a **CNAME** record: `<their-domain>` → `sites-origin.curbsidesites.com`
   - a **TXT** ownership-verification record (name + value from Cloudflare)
2. [YOU] Playing the client: add those two records at the test domain's
   registrar. ⚠️ Apex domains can't CNAME at some registrars — real-world
   answer: their DNS host's ANAME/ALIAS/flattening feature, or move the site
   to `www.` + registrar redirect. The generated instructions say this too.
3. **What to expect back:** the domain-verification job polls on every jobs
   tick (Phase 7.3 wires the scheduler; until then trigger manually:
   admin dashboard → "Run checks now"). Cloudflare validates the TXT,
   issues a per-hostname certificate (minutes to ~1 h after DNS
   propagates), the job marks the domain verified, **notifies both sides
   by email**, and flips the tenant `draft → live` if the brand gate has
   passed. Clients who stall get chased automatically every 3 days.
4. [RUN] Prove it:

```powershell
curl.exe -s https://<test-domain>/ | Select-String "Iron Ridge"   # tenant renders on the client domain
```

5. [RUN] Clean up the rehearsal: admin → Domains → remove the test domain
   (releases the custom hostname; the certificate is revoked with it).

**You should now be able to** browse both demo tenants on their platform
subdomains over TLS, log in to the admin with TOTP, and attach + detach a
client-owned domain without touching the Cloudflare dashboard.

---

## PHASE 7 — Static failover, proven with a kill (D6)

**Requires:** Phases 4, 5, 6.

### 7.1 [RUN] Export and upload the first snapshot set

> **AS BUILT (2026-07-18): skip the laptop — run 7.3 first, then
> `az containerapp job start ... -n curbside-export`.** Two things break the
> laptop path. (1) A macOS resolver that has negative-cached
> `*.sites.curbsidesites.com` fails every crawl with `ENOTFOUND` for hostnames
> that resolve fine at `1.1.1.1`; fixing it needs `sudo dscacheutil -flushcache`.
> (2) The export job inside Azure is the thing you actually need working, so
> proving it here costs nothing extra. The commands below still work once DNS
> resolves locally.
>
> **First, check the `domains` table.** The export crawls each tenant's
> **primary domain**, falling back to `<slug>.$PLATFORM_APEX` only when there
> isn't one. `db:seed` inserts fictional `.test` primary domains
> (`ironridgeoffroad.test`), which do two bad things: the crawl dies on
> `ENOTFOUND`, and — worse — had it succeeded, snapshots would be **keyed by a
> hostname no visitor ever sends**, so failover would silently never match.
> Snapshot keys must equal the hostname in the visitor's request.
>
> ```bash
> psql "$DATABASE_URL_OWNER" -c "SELECT t.slug, d.hostname, d.is_primary FROM domains d JOIN tenants t ON t.id=d.tenant_id;"
> psql "$DATABASE_URL_OWNER" -c "DELETE FROM domains WHERE hostname LIKE '%.test';"   # if seeded
> ```

From the laptop (the export crawls **through the public edge** in
`EXPORT_DIRECT` mode and refuses any page already served by the failover
path — it cannot snapshot a snapshot):

```powershell
$env:EXPORT_DIRECT = "1"
$env:PLATFORM_APEX = $PLATFORM_APEX
$env:DATABASE_URL_OWNER = "postgres://curbside_admin:$PGPW@$PG.postgres.database.azure.com:5432/curbside?sslmode=require"
$env:AZURE_STORAGE_ACCOUNT = $ST
npm run export:static      # semantic checks per page: phone number present, JSON-LD parses
npm run snapshots:upload   # → blob container 'failover', keyed by hostname
```

The exporter **fails the run** if any page flunks its semantic check
(Invariant 9) — a snapshot with the wrong phone number is worse than no
snapshot. Don't proceed on a red export.

### 7.2 ⚠️ [RUN] The deliberate origin kill

This takes every tenant site down on purpose for ~5 minutes. It's 3 demo
tenants and a weekend — this is the cheapest this drill will ever be, and
D6 is unproven theater until you've done it.

> **AS BUILT: the first run of this drill FAILED, and it found a real bug.**
> Deactivating the revision made every tenant serve a bare **404** with no
> `x-curbside-failover` header — no snapshot at all. Cause: Azure Container
> Apps answers **404, not 503**, when no revision is active, and `worker.js`
> only failed over on `>= 500` or an unreachable origin, so it classified a
> dead origin as healthy and forwarded the 404. The single most likely
> production outage mode was the one case D6 did not cover.
>
> Fixed in `infra/cloudflare/worker.js`: a 404 is now **suspect** rather than
> healthy. Because 404 is also the right answer for an unknown tenant, status
> alone can't distinguish them — **the snapshot's existence is the
> disambiguator.** Only LIVE tenants are exported, so a 404 for a hostname and
> path we hold a snapshot of means the origin is broken, while a genuinely
> unknown host has no snapshot and falls through to a clean 404. Verified: a
> nonexistent slug and a nonexistent page on a live tenant both still 404.
>
> **Known edge case:** a tenant flipped `live → draft` 404s at the origin while
> its snapshot still exists, so the edge would serve the stale snapshot until
> the next nightly export prunes it. Suspended tenants are unaffected (they
> serve a 200 under-construction page). Prune snapshots for non-live tenants if
> this ever matters.
>
> **Run it from a script with the reactivate in a `trap`,** so a failed
> assertion or a timeout still brings production back rather than leaving every
> tenant dark. Do not run the kill and the restore as two hand-typed commands.

```powershell
# Kill: deactivate the serving revision.
$REV = az containerapp revision list --resource-group $RG --name $APP --query "[?properties.active].name" -o tsv
az containerapp revision deactivate --resource-group $RG --name $APP --revision $REV

# Wait ~60s, then prove the snapshot ACTUALLY serves:
curl.exe -s -D - https://iron-ridge-offroad.sites.curbsidesites.com/ -o body.html | Select-String "x-curbside-failover"  # header present
Select-String "760" body.html            # the right tenant's phone — semantic, not just 200
Select-String "tel:" body.html           # forms degraded to tap-to-call
Remove-Item body.html
```

[YOU] Check your inbox: the Worker's **failover alert email** (if you set
`RESEND_API_KEY` on it; if Phase 8 hasn't happened yet, come back and re-run
this drill after it — an unalerted failover is explicitly the failure mode
D6 forbids).

```powershell
# Resurrect:
az containerapp revision activate --resource-group $RG --name $APP --revision $REV
curl.exe -s -o NUL -w "%{http_code}" https://iron-ridge-offroad.sites.curbsidesites.com/   # 200, no failover header
```

### 7.3 [RUN] Schedule it: the jobs tick and the nightly export

Two Container Apps **Jobs** — the 15-minute platform tick (domain polling,
dunning, alarms, growth scheduler) and the nightly snapshot refresh.

> **AS BUILT — four corrections. The PowerShell below is kept for reference but
> does not work as written.**
>
> **1. Use ONE user-assigned identity for both jobs, created and granted
> BEFORE either job exists.** A system-assigned identity doesn't exist until
> the job is created, but the job can't be created without `AcrPull` — a
> chicken-and-egg that leaves you with a job silently running
> `mcr.microsoft.com/k8se/quickstart:latest` (the same trap as Phase 5.4). A
> user-assigned identity breaks the cycle and is reusable:
>
> ```bash
> az identity create -g "$RESOURCE_GROUP" -n curbside-jobs-id
> UAMI=$(az identity show -g "$RESOURCE_GROUP" -n curbside-jobs-id --query id -o tsv)
> P=$(az identity show -g "$RESOURCE_GROUP" -n curbside-jobs-id --query principalId -o tsv)
> CID=$(az identity show -g "$RESOURCE_GROUP" -n curbside-jobs-id --query clientId -o tsv)
> az role assignment create --assignee-object-id "$P" --assignee-principal-type ServicePrincipal \
>   --role AcrPull --scope "$(az acr show -n "$CONTAINER_REGISTRY" -g "$RESOURCE_GROUP" --query id -o tsv)"
> az role assignment create --assignee-object-id "$P" --assignee-principal-type ServicePrincipal \
>   --role "Key Vault Secrets User" --scope "$(az keyvault show -n "$KEYVAULT" --query id -o tsv)"
> az role assignment create --assignee-object-id "$P" --assignee-principal-type ServicePrincipal \
>   --role "Storage Blob Data Contributor" --scope "$(az storage account show -n "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" --query id -o tsv)"
> ```
>
> Then create each job with `--mi-user-assigned "$UAMI" --registry-identity "$UAMI"`
> and `identityref:$UAMI` in the Key Vault secret refs. (`--system-assigned` is
> `--mi-system-assigned` on the current CLI; az's own auto AcrPull grant fails
> because it passes the *login server* where a *registry name* is expected —
> harmless once you've granted it above.)
>
> **2. `AZURE_CLIENT_ID` is REQUIRED on every job using the user-assigned
> identity.** `DefaultAzureCredential` cannot pick a user-assigned identity on
> its own; without it the export runs, passes every semantic check, and then
> dies at the upload with `CredentialUnavailableError`. Set
> `AZURE_CLIENT_ID=$CID`.
>
> **3. `--command`/`--args` cannot express `sh -c "a && b"`.** Passing three
> values to `--command` errors with `unrecognized arguments`; comma-joining
> them yields the single literal arg `-c,npm run …` and the container dies with
> `/bin/sh: 0: Illegal option -,`. **Set the args via YAML instead:**
> `az containerapp job show ... -o yaml > job.yaml`, edit, then
> `az containerapp job update --yaml job.yaml`:
>
> ```yaml
>     - args:
>       - -c
>       - npm run export:static && npm run snapshots:upload
>       command:
>       - /bin/sh
> ```
>
> **4. Quote any arg containing a colon-space in YAML.** `-H "Authorization:
> Bearer $TOKEN"` parses as a nested mapping and silently becomes a mangled
> dict. Use a folded scalar:
>
> ```yaml
>       - >-
>         curl -fsS -X POST -H "Authorization: Bearer $CRON_TOKEN"
>         https://$FQDN/api/jobs/run
> ```


```powershell
# The tick: curl the app's own jobs endpoint. Runs INSIDE Azure, addressed
# directly to the ACA FQDN (no edge round-trip).
az containerapp job create --resource-group $RG --name curbside-tick --environment $ACAENV `
  --trigger-type Schedule --cron-expression "*/15 * * * *" `
  --image curlimages/curl:latest --cpu 0.25 --memory 0.5Gi `
  --replica-timeout 600 --replica-retry-limit 1 `
  --secrets "cron-token=keyvaultref:https://$KV.vault.azure.net/secrets/cron-token,identityref:system" `
  --env-vars "CRON_TOKEN=secretref:cron-token" `
  --command "/bin/sh" "-c" "curl -fsS -X POST -H \"Authorization: Bearer `$CRON_TOKEN\" https://$FQDN/api/jobs/run"

$TICK_PRINCIPAL = az containerapp job show --resource-group $RG --name curbside-tick --query identity.principalId -o tsv 2>$null
# (if the job wasn't created with an identity, add one, then grant KV read):
az containerapp job identity assign --resource-group $RG --name curbside-tick --system-assigned
$TICK_PRINCIPAL = az containerapp job show --resource-group $RG --name curbside-tick --query identity.principalId -o tsv
az role assignment create --assignee $TICK_PRINCIPAL --role "Key Vault Secrets User" --scope $KVID

# The nightly export (09:00 UTC = 1–2 AM Pacific), running the APP image
# with a different command:
az containerapp job create --resource-group $RG --name curbside-export --environment $ACAENV `
  --trigger-type Schedule --cron-expression "0 9 * * *" `
  --image "$ACRLOGIN/curbside-app:v1" --registry-server "$ACRLOGIN" --registry-identity system `
  --cpu 0.5 --memory 1.0Gi --replica-timeout 1800 --replica-retry-limit 1 --system-assigned `
  --secrets "db-control=keyvaultref:https://$KV.vault.azure.net/secrets/curbside-control-database-url,identityref:system" `
  --env-vars "DATABASE_URL_CONTROL=secretref:db-control" "EXPORT_DIRECT=1" `
             "PLATFORM_APEX=$PLATFORM_APEX" "AZURE_STORAGE_ACCOUNT=$ST" `
  --command "/bin/sh" "-c" "npm run export:static && npm run snapshots:upload"

$EXPORT_PRINCIPAL = az containerapp job show --resource-group $RG --name curbside-export --query identity.principalId -o tsv
az role assignment create --assignee $EXPORT_PRINCIPAL --role "Key Vault Secrets User" --scope $KVID
az role assignment create --assignee $EXPORT_PRINCIPAL --role "Storage Blob Data Contributor" --scope $STID

# Prove both once, on demand:
az containerapp job start --resource-group $RG --name curbside-tick
az containerapp job start --resource-group $RG --name curbside-export
az containerapp job execution list --resource-group $RG --name curbside-export -o table   # → Succeeded
```

Also run the export **after every deploy** (it's one `job start` — put it in
your deploy ritual, Phase 11.1).

**You should now be able to** kill the origin and watch the correct tenant's
snapshot serve with tap-to-call intact, get emailed about it, and see both
scheduled jobs listed with a successful execution each.

---

## PHASE 8 — Email that actually delivers

**Requires:** Phase 6 (DNS lives at Cloudflare now).

### 8.1 [YOU] Resend account + sending domain

1. resend.com → sign up (Curbside's account — this is a platform key,
   `key_owner: curbside`).
2. Domains → Add `curbsidesites.com` → region closest (US). Resend shows
   DKIM (3 CNAMEs or TXT records) + SPF include records.
3. Add each record in Cloudflare DNS (dash → DNS). **DNS-only (grey cloud)**
   for these — email auth records must not be proxied.

   ⚠️ **SPF: merge, never add a second record.** A domain may have exactly one
   SPF TXT record. Two is a `permerror` and **both** fail — which shows up as
   `SPF: FAIL` on the 8.3 test with no obvious cause. `curbsidesites.com`
   already carries Microsoft 365's SPF, so the single record becomes:

   ```
   v=spf1 include:spf.protection.outlook.com include:<resend's include> -all
   ```

   Take Resend's include string from its dashboard verbatim; don't guess it.
   Keep the terminating `-all` and keep it last. Verify afterwards that exactly
   one `v=spf1` line comes back:

   ```powershell
   dig +short TXT curbsidesites.com | Select-String "v=spf1"
   ```

   DKIM is per-selector, so Resend's DKIM records coexist with Microsoft's
   `selector1`/`selector2` without conflict — DKIM needs no merging.

4. Add a DMARC record yourself (Resend won't force it, inboxes increasingly
   do): TXT `_dmarc.curbsidesites.com` =
   `v=DMARC1; p=none; rua=mailto:valadezj045@gmail.com` — `p=none` while
   warming (CALENDAR.md), tighten to `quarantine` after 2–4 clean weeks.

   ⚠️ **Registrars publish their own DMARC default — replace it, don't add to
   it.** As built, GoDaddy had already published
   `p=quarantine; rua=mailto:dmarc_rua@onsecureserver.net`. That is worse than
   nothing here on both counts: `p=quarantine` quarantines misaligned mail
   while you're still warming (the runbook wants `p=none` until it's clean),
   and the aggregate reports go to the registrar instead of to you, so you get
   no visibility into what's failing. Like SPF, only one `_dmarc` record is
   valid — overwrite it.
5. Wait for Resend to show **Verified** (minutes usually).
6. API Keys → create `curbside-platform` full-access key.

### 8.2 [RUN] Seed the key

```powershell
az keyvault secret set --vault-name $KV --name curbside-resend-api-key --value "<the key>"
# The edge Worker's failover alerts use the same key:
cd infra/cloudflare; npx wrangler@latest secret put RESEND_API_KEY; cd ../..
```

### 8.3 [YOU] The *delivered* test — delivered, not sent

Wait ~5 min (KV cache), then submit the intake form at
`https://sites.curbsidesites.com/onboard` with a **fake test business** and
your real Gmail as the owner email. Then:

1. The intake receipt (with the preview link) lands in the **inbox** — not
   spam — of a Gmail account. Gmail → open the message → ⋮ → Show original →
   confirm `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
2. If it's in spam: you're warming a brand-new domain (expected the first
   days, CALENDAR.md). Send a handful of real, human messages from
   `hello@curbsidesites.com` (Resend → no; use any mailbox provider on the
   domain, or simply keep volumes tiny) and re-test tomorrow. Do not blast.
3. [RUN] Clean up the fake tenant: admin → the test tenant → Offboard.

Per-**client** domains (real clients later, not demo tenants): the tenant's
lead notifications send from the client's own domain, which needs its own
Resend domain + DKIM records — those records ride along in the same
registrar-instructions email as the Phase 6.6 CNAME/TXT. The control
plane's deliverability job (SPF/DKIM/DMARC per verified domain) then checks
it continuously and alarms on drift; a lead notification landing in spam is
the churn machine (CONTROL-PLANE Part 5). Until a client domain is
verified in Resend, that tenant's email integration stays in demo mode —
configure `config.from` + flip `mode='live'` per README's go-live runbook.

**You should now be able to** show a Gmail "Show original" with three
PASSes for an intake receipt, and know exactly which DNS records a future
client's domain will need for its own sending.

---

## PHASE 9 — Stripe (D7, D19)

**Requires:** Phase 6 (the webhook needs a public URL). Start the account
**today** regardless (CALENDAR.md — verification can take days).

### 9.1 [YOU] Account + ACH + dunning

1. dashboard.stripe.com → create account → complete business verification
   (EIN/SSN, bank account for payouts). Until verified you're in test mode —
   everything below works there first anyway.
2. Settings → Payment methods: enable **ACH Direct Debit** (`us_bank_account`)
   and cards. ACH is the default by decision (D7): on a $749/mo plan, card
   fees are ~$270/yr per client.
3. Settings → Billing → **Revenue recovery**: turn ON smart retries (4
   retries over ~2 weeks), ON "email customers about failed payments", ON
   "send reminders for upcoming renewals". This is the automated dunning —
   the app's day-3/7/14 ladder rides on top and **never suspends by itself**
   (a human confirms in the queue, CONTROL-PLANE Part 4).

### 9.2 [YOU] Products and prices — the D19 ladder, exactly

Products → Add. Create each with a **recurring monthly** price unless noted:

| Product | Price | Note |
|---|---|---|
| Curb (care plan) | $199/mo | mandatory base |
| Curb+ (visibility) | $749/mo | |
| Curb Pro (growth) | $1,499/mo | |
| Add-on: CRM | $49/mo | |
| Add-on: Booking | $79/mo | |
| Add-on: AI quote assistant | $149/mo | |
| Add-on: Call tracking | $99/mo | |
| Setup deposit | $1,000 **one-time** | collected via Checkout before build (Session 5 wires the flow; the price exists now) |

Copy each **price ID** (`price_...`) as you go.

### 9.3 [RUN] Wire the price map + webhook

Build the JSON map (shape per `src/lib/control/billing.ts` — `plan_tier`
for plans, `flag` for add-ons; the flag names are exactly these):

```powershell
$PRICE_MAP = '{"price_XXX1":{"plan_tier":"curb","mrr_cents":19900},"price_XXX2":{"plan_tier":"curb_plus","mrr_cents":74900},"price_XXX3":{"plan_tier":"curb_pro","mrr_cents":149900},"price_XXX4":{"flag":"crm","mrr_cents":4900},"price_XXX5":{"flag":"booking","mrr_cents":7900},"price_XXX6":{"flag":"quote_assistant","mrr_cents":14900},"price_XXX7":{"flag":"call_tracking","mrr_cents":9900}}'
az containerapp update --resource-group $RG --name $APP --set-env-vars "STRIPE_PRICE_MAP=$PRICE_MAP"
```

[YOU] Developers → Webhooks → Add endpoint:
`https://sites.curbsidesites.com/api/stripe/webhook`, events:
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
Copy the **signing secret** (`whsec_...`).

⚠️ Do this in **test mode first** (toggle top-right; test mode has its own
endpoint list, price IDs, and signing secret). The full rehearsal below runs
in test mode against production infrastructure — same code path, fake money.

```powershell
az keyvault secret set --vault-name $KV --name curbside-stripe-webhook-secret --value "whsec_<test-mode>"
```

The moment this secret exists, the app **rejects** unsigned/simulated events
— the demo Stripe provider is only reachable when the secret is absent, by
design (ASSUMPTIONS #43).

### 9.4 [YOU] The test subscription — watch a flag flip

(Test mode.) Customers → Create: name "Iron Ridge Offroad", email yours,
**metadata key `tenant_slug` = `iron-ridge-offroad`** — that metadata is how
the webhook links the customer on first event. Then Subscriptions → Create →
that customer → test-mode Curb+ price + the CRM add-on price → payment
method: test card `4242…`, or better, test ACH (`Test payment methods` →
us_bank_account) since ACH-default is the real flow. Create it.

Within seconds the webhook should land. Verify:

1. Admin → iron-ridge-offroad → Billing panel: subscription active,
   `plan_tier = curb_plus`, MRR right.
2. The `crm` **feature flag flipped on** — no provisioning step existed
   (D19's whole point).
3. Stripe dashboard → the webhook endpoint → recent deliveries → `200`s.

Then rehearse failure honestly: Subscriptions → the test sub → update →
switch the payment method to test card `4000000000000341` (attaches, then
fails payment) → trigger an invoice. Watch: warning emails ladder (day 3/7/14
— compressed in test via the dashboard's invoice "advance" controls or just
trust the local sim already proved the ladder), and confirm what does NOT
happen: no automatic suspension, ever — a `pending action` appears in the
admin queue instead, waiting for a human.

[YOU] Finally, cancel the test subscription, delete the test customer, flip
the dashboard to **live mode**, repeat 9.3's webhook creation there, and:

```powershell
az keyvault secret set --vault-name $KV --name curbside-stripe-webhook-secret --value "whsec_<LIVE>"
```

(Live `STRIPE_PRICE_MAP` too, if you built prices in test mode first —
live-mode products need creating once more and their `price_...` IDs differ.)

**You should now be able to** create a Stripe subscription and watch
`plan_tier` and a feature flag change on the tenant row with zero manual
provisioning — and state with confidence that a $2 card decline cannot kill
a client's site without a human clicking "suspend".

---

## PHASE 10 — The first three live demo tenants, through the front door

**Requires:** Phases 5–8. **Rule: the intake form is the only door.** If you
catch yourself inserting tenant rows by hand, stop — the pipeline is broken
and fixing it is the task (CONTROL-PLANE Part 12.2).

### 10.1 [YOU] Invent three demo businesses

Three trades, three vibes, so the fleet demos range (the two seeds are
off-road + marine; complement them) — e.g.:

1. **Summit HVAC** — heating/air, Riverside. Clean, trustworthy, blue.
2. **Rank & File Detailing** — mobile detailing, Temecula. Dark, glossy.
3. **Golden State Landscape** — landscaping, Escondido. Warm, green.

Fictional names (check: no real local business carries them — search Maps),
real geography, plausible services. Demo rows are labeled "sample" on-page
(D5); these tenants exist to be shown to prospects, never to deceive one.

### 10.2 [YOU] Run each through the real pipeline

Per business, in order — this is the same choreography a real client gets:

1. **Intake:** `https://sites.curbsidesites.com/onboard` — fill everything:
   identity, hours, services (3–5 each), a logo (generate or design a simple
   one — the brand proposer extracts palette from it), voice field in the
   owner's imagined words, 2–3 add-on checkboxes (they become feature flags,
   D19). Owner email: yours (plus-addressing works: `you+summit@gmail.com`).
2. **Receipt lands** (Phase 8 means it's actually delivered) with the
   preview link. Open it — the draft renders **immediately**, brand-proposal
   tokens already applied. That's the sales artifact working.
3. **Brand gate** (the one human gate — do not rubber-stamp it): admin →
   tenant → Brand gate. Look at the preview *while* reading the contrast
   report and the do-not-do list. Reject with a note and re-upload if the
   palette reads cheap; approve when it doesn't.
4. **Content seeding:** admin → tenant → Seed content (no call transcript
   exists → it uses the intake voice field — the consent regime working as
   designed). **Read every draft post before publishing** (GROWTH Part 6:
   these are trades; a confidently wrong maintenance interval published
   under a real-looking business is exactly what the human gate exists to
   catch). Publish the 2–3 that survive your read.

### 10.3 [RUN] Images — source, review, then move them to Blob

```powershell
$env:ANTHROPIC_API_KEY = "<operator key>"     # enables --ai (better queries)
$env:PEXELS_API_KEY = "<free key from pexels.com/api>"   # much better picks than Openverse
npm run images:source summit-hvac -- --ai
# [YOU] open .data/image-candidates/summit-hvac/review.html and LOOK at every
# image (Part 10: reject competitor branding, readable plates, wrong region,
# wrong subject class — expect to reject a third to half):
npm run images:source summit-hvac -- --apply hero=2 gallery-1=4 gallery-2=1
```

The apply step writes local `/uploads/...` paths — correct for a laptop,
404 in the cloud. Move the winners to Blob and rewrite the URLs (needs the
`rdbms-connect` az extension, it'll self-install on first use):

```powershell
az storage blob upload-batch --account-name $ST --destination "tenant-images/summit-hvac" `
  --source ".data/uploads/summit-hvac" --auth-mode login --overwrite
az postgres flexible-server execute --name $PG --admin-user curbside_admin --admin-password $PGPW `
  --database-name curbside --querytext "UPDATE images SET url = replace(url, '/uploads/summit-hvac/', 'https://$ST.blob.core.windows.net/tenant-images/summit-hvac/') WHERE url LIKE '/uploads/summit-hvac/%'"
```

Cache note: direct SQL writes show up within the 10-minute ISR window; to
see it now, admin → tenant → any no-op save (which revalidates), or wait.

Repeat 10.2 + 10.3 for the other two businesses.

### 10.4 [RUN] Go live (platform-subdomain-only) and re-snapshot

Demo tenants have no client domain — staff force-flip them live (README's
control-plane recipes: tenant page → force go-live; requires the brand gate
passed, which 10.2.3 did):

[YOU] Admin → each tenant → Force go-live (platform subdomain only).

```powershell
# All five (2 seeds + 3 new) now serve as status=live; refresh the failover set:
az containerapp job start --resource-group $RG --name curbside-export
# Verify each:
"iron-ridge-offroad","delta-marine-service","summit-hvac","rank-and-file-detailing","golden-state-landscape" |
  ForEach-Object { "$_ : " + (curl.exe -s -o NUL -w "%{http_code}" "https://$_.$PLATFORM_APEX/") }
```

All five must print 200. Platform subdomains stay `noindex` (ASSUMPTIONS #7)
— these are demo/sales surfaces, not SEO surfaces, and they never compete
with a future client domain.

**You should now be able to** hand anyone a phone with
`https://summit-hvac.sites.curbsidesites.com` and watch a complete,
branded, accessible site load — knowing it entered through the same form a
paying client will use, and that a human looked at its brand, its images,
and every published word.

---

## PHASE 11 — Monitoring, alerting, and the rollback you've already rehearsed

**Requires:** everything above.

### 11.1 [RUN] The deploy ritual (write it on a sticky note)

```powershell
az acr build --registry $ACR --image curbside-app:v2 .          # next tag each time
az containerapp update --resource-group $RG --name $APP --image "$ACRLOGIN/curbside-app:v2"
Invoke-RestMethod "https://$FQDN/api/health"                     # ok: true
curl.exe -s https://iron-ridge-offroad.sites.curbsidesites.com/ | Select-String "760"   # semantic, per Invariant 9
az containerapp job start --resource-group $RG --name curbside-export                    # post-deploy snapshot (D6)
```

Migrations stay **forward-only and additive** — that discipline (already the
repo's rule) is what makes image rollback below always DB-safe.

### 11.2 [RUN] Keep old revisions around (rollback vocabulary)

```powershell
az containerapp revision set-mode --resource-group $RG --name $APP --mode multiple
```

From now on each deploy creates a new revision and shifts traffic to it;
the previous ones stay warm-standby at zero traffic.

### 11.3 [RUN] Azure Monitor alerts → your inbox

```powershell
az monitor action-group create --resource-group $RG --name curbside-alerts --short-name curbside `
  --action email jason valadezj045@gmail.com

$APPID = az containerapp show --resource-group $RG --name $APP --query id -o tsv
$PGID  = az postgres flexible-server show --resource-group $RG --name $PG --query id -o tsv

# Database filling up — the one that ends in an outage if ignored:
az monitor metrics alert create --resource-group $RG --name pg-storage-80 --scopes $PGID `
  --condition "avg storage_percent > 80" --window-size 15m --evaluation-frequency 15m `
  --action curbside-alerts --description "Postgres storage past 80%"
# Database CPU pinned (B-series burst credits exhausted look like this):
az monitor metrics alert create --resource-group $RG --name pg-cpu-90 --scopes $PGID `
  --condition "avg cpu_percent > 90" --window-size 30m --evaluation-frequency 15m `
  --action curbside-alerts --description "Postgres CPU >90% for 30m"
# App replicas restarting (crash loop after a bad deploy):
az monitor metrics alert create --resource-group $RG --name app-restarts --scopes $APPID `
  --condition "total RestartCount > 3" --window-size 15m --evaluation-frequency 5m `
  --action curbside-alerts --description "Container restarts"
```

(If a `--condition` string is rejected — metric names occasionally shift —
create the same three in the portal: Monitoring → Alerts → Create. The
*set* matters, not the syntax.)

Alert coverage, honestly stated: **edge failover** → Worker email (proven
in 7.2). **Business-level silent failures** (forms stopped delivering,
deliverability, secret expiry, integration errors) → the in-app jobs +
alerts dashboard, running every 15 min (7.3). **Infra** → the three alerts
above. **The gap:** if the app is down, in-app alarms are down with it —
that's covered by the Worker email + `app-restarts`, and it's why both
exist. Sentry (D3) is *not* wired in this session — ASSUMPTIONS #77.

### 11.4 [YOU] Rollback from a phone — verify it before you need it

The scenario this exists for: a deploy breaks 200 phone lines at 6 pm
Friday; the recovery path cannot require a laptop (ARCHITECTURE §5).

1. Install the **Azure mobile app**, sign in, confirm you can reach
   Cloud Shell (hamburger → Cloud Shell).
2. Deploy a new revision from the laptop (any trivial change, or reuse the
   same image with a new tag — 11.1).
3. **On the phone**, Cloud Shell:

```bash
az containerapp revision list -g curbside-prod -n curbside-app \
  --query "[].{name:name,active:properties.active,traffic:properties.trafficWeight}" -o table
az containerapp ingress traffic set -g curbside-prod -n curbside-app \
  --revision-weight <previous-revision-name>=100
```

4. Reload a tenant site on the phone's browser — old build serving. That's
   the whole rollback: **one command, from a pocket.** Shift traffic back
   to the newest revision the same way.
5. [YOU] Save those two commands as a note *in the phone*. At 6 pm Friday
   you will not be composing them from memory.

**You should now be able to** name, without looking: where a failover
alert arrives, where a dead-form alarm shows, what three Azure alerts
exist, and the one command that rolls the fleet back — and you've executed
that command from your phone once already.

---

## APPENDIX A — The app's full production environment (reference)

| Env var | From | Set in phase |
|---|---|---|
| `DATABASE_URL` | KV `curbside-app-database-url` (secretref) | 5.4 |
| `DATABASE_URL_CONTROL` | KV `curbside-control-database-url` (secretref) | 5.4 |
| `STAFF_STATUS_TOKEN` / `STAFF_TOTP_ENC_KEY` / `CRON_TOKEN` | KV (secretrefs) | 5.4 |
| `SECRET_PROVIDER=keyvault`, `AZURE_KEY_VAULT_NAME` | literal | 5.4 |
| `AZURE_STORAGE_ACCOUNT` | literal | 5.4 |
| `PLATFORM_APEX=sites.curbsidesites.com` | literal | 5.4 |
| `TRUST_PROXY_HOST=1` | literal (edge Worker contract) | 5.4 |
| `CF_FALLBACK_ORIGIN`, `PLATFORM_EMAIL_FROM`, `STAFF_NOTIFY_EMAIL` | literal | 5.4 |
| `CLOUDFLARE_ZONE_ID` | literal | 6.6 |
| `STRIPE_PRICE_MAP` | literal JSON | 9.3 |

Key Vault (via `kv_secret_ref` / secretref): `curbside-anthropic-api-key`,
`curbside-resend-api-key`, `curbside-cloudflare-api-token`,
`curbside-stripe-webhook-secret`, the five infra secrets above, and
per-tenant integration keys per SECRETS.md as clients go live.

## APPENDIX B — Half-successes index (the ways steps lie)

| Symptom | Actually |
|---|---|
| Every secret "unpopulated" on `/api/status` | `SECRET_PROVIDER` unset/typo'd (5.4) or RBAC not propagated yet (3.1) |
| `Forbidden` seeding KV secrets as subscription Owner | missing data-plane role (3.1) |
| TLS error only on `*.sites.` hosts | ACM cert missing/pending (6.3) |
| Tenant 404s through the edge but works on `$FQDN`-direct never | grey-cloud DNS record (6.2) or Worker route not deployed (6.4) |
| Stripe events all 400 | test/live signing-secret mismatch (9.3) — the app refuses rather than trusting, by design |
| SQL edits "not showing up" | the 10-min ISR window (10.3) — not a bug |
| `db:migrate` hangs then times out | firewall — your IP changed (2.3) |
| Snapshot drill serves 502 not the snapshot | blob container not public / wrong `SNAPSHOT_HOST` in wrangler.toml (7.2) — the Worker found no snapshot and passed the outage through |
| Jobs never run | `CRON_TOKEN` mismatch between KV and the tick job → every tick 401s silently; check `az containerapp job execution list` (7.3) |
| App stuck `Activating`, startup probe never passes | `containerapp create` silently deployed `k8se/quickstart` instead of your image — it listens on `:80`, ingress targets `3000`. Check the running image, not the logs (5.2) |
| Image pull `UNAUTHORIZED`, no container at all | Missing `AcrPull` on the app's managed identity (5.3) — not the expected crash-loop |
| `env create` fails on a fresh subscription | `Microsoft.App` and/or `Microsoft.OperationalInsights` unregistered; fixing only the first still fails on the second (5.2) |
| `db:migrate` fails `0A000` … `check_extension_permissions` | `pgcrypto` not allowlisted via `azure.extensions` (2.1) |
| `db:migrate` fails *only on re-run*, "must have SUPERUSER to change SUPERUSER" | First run already created the roles; Azure's admin can't re-declare the attributes. The runner asserts instead — you're on an old copy of `scripts/migrate.ts` (2.3) |
| `db:seed` / `staff:create` exit 0 but production is empty | Ran in a shell without the Azure env sourced — dotenv fell back to `.env.local` and seeded local Docker. Nothing reads `.env.production.local` (2.3) |
| Client edits their hours, sees them flap back for ~10 min | More than one replica: ISR cache is per-instance and `revalidateTag` only reaches the replica that served the edit (5.2) |
| Everything on `/api/status` shows `populated:false` | Expected when no integration secrets are seeded yet — but indistinguishable from `SECRET_PROVIDER` unset. Seed one real key and re-check (5.6) |
| Business email dies hours after the Cloudflare cutover | Nameserver swap replaced the whole zone; MX/SPF/autodiscover/DKIM were never recreated at Cloudflare (6.1a). Senders bounce; you see nothing |
| `SPF: FAIL` on the 8.3 Gmail test, records look right | Two `v=spf1` TXT records = `permerror`, **both** fail. Merge Microsoft's and Resend's includes into one line (8.1) |
| Resend mail quarantined during warmup | Registrar's default DMARC at `p=quarantine` was never replaced; its `rua` also points at the registrar, so you get no reports (8.1) |
| Mail authenticates until someone forwards it, then fails | M365 DKIM never enabled — `selector1/2._domainkey` empty, so only SPF alignment is carrying it (6.1a) |
