# Onboarding a client: demo → live

How a business goes from "never heard of us" to a site on their own domain.
Written while onboarding **dubdating.com** as a simulated client, so every step
below is one that was actually run — not a plan. Steps not yet exercised are
marked **UNPROVEN**; fix this file the first time reality disagrees with it.

Companion to `RUNBOOK.md` (which builds the platform). This file is per-client
and assumes the platform is already up.

---

## The shape of it

A tenant lives at two URLs, and the whole process is about moving between them:

| Phase | URL | Tenant status | Who can see it |
|---|---|---|---|
| Demo | `<slug>.sites.curbsidesites.com` | `draft` | anyone with the link |
| Live | `theirdomain.com` | `live` | the public |

The platform subdomain **works the moment the tenant row exists** — no DNS, no
waiting, nothing for the client to do. That is the demo you sell with. The
custom domain is added later and the platform URL keeps working forever as a
fallback (`src/lib/tenant.ts` resolution order: custom domain → platform
subdomain → 404).

A `draft` tenant is reachable on the platform subdomain but its custom domain
resolves to `null`. That is deliberate: you can hand out a preview link without
the client's real domain half-working in public.

---

## One-time platform setup (before ANY custom domain works)

Custom domains need Cloudflare for SaaS. Until all five are done, the platform
silently uses the **demo** hostname provider and no real domain will connect.

- [ ] **1. Enable Cloudflare for SaaS** on the `curbsidesites.com` zone.
      Dashboard → SSL/TLS → Custom Hostnames → **Enable**, then add payment
      information (required on non-Enterprise zones even though the bill is $0).
      Free plan includes **100 custom hostnames**; beyond that it is $0.10 each
      per month, no base fee. Verified 2026-07-18.
      Until this is done every custom-hostname API call — **including reads** —
      returns `1404: No quota has been allocated for this zone or for this
      account`. That error text points at Enterprise sales and looks like a
      paywall. **It is not one.** Check with:
      ```bash
      source ~/.curbside-env-01
      curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/custom_hostnames" \
        -H "Authorization: Bearer $CF_API_TOKEN" | python3 -m json.tool | head -20
      ```
- [ ] **2. Set the fallback origin** to `sites-origin.curbsidesites.com`.
      That record already exists (`AAAA 100::`, proxied) and is what
      `CF_FALLBACK_ORIGIN` defaults to in `src/lib/adapters/cloudflare/live.ts`.
- [ ] **3. Create a narrow API token** — permission `SSL and Certificates: Edit`
      on this zone only. **Not** the broad setup token from RUNBOOK Phase 6;
      this one is read by the running app and lives in Key Vault.
- [ ] **4. Store it and set the zone id together** (see below).
- [ ] **5. Restore the catch-all Worker route.** `infra/cloudflare/wrangler.toml`
      currently lists explicit patterns because `*/*` is rejected until
      Cloudflare for SaaS is on. **Client domains will not route until this is
      changed back** — the explicit patterns only match `*.curbsidesites.com`.

### Step 4 — both halves, or neither

```bash
source ~/.curbside-env-01

az keyvault secret set --vault-name "$KEYVAULT" \
  --name curbside-cloudflare-api-token --value "<the narrow token>"

az containerapp update -n "$CONTAINER_APP" -g "$RESOURCE_GROUP" \
  --set-env-vars "CLOUDFLARE_ZONE_ID=$CF_ZONE_ID"
```

Do not do one without the other. `src/lib/adapters/cloudflare/index.ts` throws
on a half-configured pair, by design (D11): the failure mode it refuses to
allow is an operator believing domains are real while the demo provider quietly
serves. If you must back out, unset `CLOUDFLARE_ZONE_ID` — don't leave it set.

Verify which provider is live before trusting anything:

```bash
# In the app logs, provisioning a domain audits mode: "live" | "demo"
az containerapp logs show -n "$CONTAINER_APP" -g "$RESOURCE_GROUP" --tail 50
```

---

## Per-client runbook

### 1. Intake — the client fills in the form

**https://sites.curbsidesites.com/onboard** (verified: 200)

Creates the tenant via `createTenantFromIntake()`:

- `status = 'draft'`, `plan_tier = 'curb'`, addon checkboxes → `features`
- slug from the business name, deduped in-transaction (`joes-plumbing`,
  `joes-plumbing-2`, …) so two simultaneous submissions can't collide
- phone must be 10-digit US or the submission is rejected
- a brand proposal is generated from the industry (+ logo if uploaded)

Slugs can never be `admin, www, api, app, staff, sites, status, platform,
onboard, assets, cdn, mail, portal` — enforced by a CHECK constraint
(`migrations/002_control_plane.sql`), not by convention.

**The demo URL is live immediately:** `https://<slug>.sites.curbsidesites.com`

### 2. Seed the content

The demo is only persuasive with real photos and real copy. Images come from
the Part 10 pipeline:

```bash
npm run images:source <slug> -- --auto      # sources + auto-picks
```

Candidates cache in `.data/image-candidates/<slug>/`, winners copy to
`.data/uploads/<slug>/<slot>.jpg`, and `images.url` + `images.credit` are set.

**Local sourcing does not reach production.** It writes `/uploads/...` paths
that only exist on the machine that ran it. To publish, upload to the
`tenant-images` blob container and set `images.url` to the blob URL —
see "Publishing images to production" below. A tenant whose `images.url` is
NULL serves branded SVG placeholders and **the seed still reports success**,
so check the column, not the exit code:

```sql
SELECT t.slug, count(*) FILTER (WHERE i.url IS NOT NULL) AS with_url, count(*)
  FROM images i JOIN tenants t ON t.id = i.tenant_id GROUP BY t.slug;
```

Attribution is not optional. Openverse images are CC BY / CC BY-SA and the
`credit` column is what the gallery renders to satisfy the licence. Never set
`url` without `credit`.

### 3. Brand gate + review

Staff work the tenant in the admin control plane:

**https://admin.sites.curbsidesites.com/login**

(Note the host: `admin.$PLATFORM_APEX`, so `admin.sites.…`, not
`admin.curbsidesites.com` — that one 404s.)

The brand gate must pass before a tenant can go live. Content drafts also land
`published_at NULL` with a `review_content` queue item and require a human to
read them — mandatory for trades content, where a confidently wrong spec is a
safety problem, not an SEO problem.

### 4. Connect the domain — **UNPROVEN below this line**

`provisionDomain(tenantId, hostname, actor)`:

1. Creates a Cloudflare Custom Hostname (DV cert, HTTP validation)
2. Inserts a `domains` row, `verification_status = 'pending'`
3. Emails the client **registrar-specific** instructions —
   `registrarInstructions()` has tailored steps for GoDaddy, Namecheap,
   Squarespace, Cloudflare, IONOS, Network Solutions, plus a generic fallback

The client adds a CNAME to `sites-origin.curbsidesites.com` (plus a TXT for
ownership verification if Cloudflare asks). **They never share registrar
credentials and the domain stays in their account** — that's D8, and the email
says so explicitly.

A chase job re-nudges after 3 days. Clients are slow at this; the chase is
code, not someone's memory.

> Requires Resend (RUNBOOK Phase 8). Until then the instruction email has
> nowhere to go — send the records by hand.

### 5. Go live

`maybeGoLive()` flips `draft → live` only when **the brand gate has passed AND
a domain has verified**, unless staff explicitly force it. Both conditions, or
it stays a draft.

### 6. Verify — the checks that actually mean something

```bash
SLUG=<slug>; DOMAIN=<theirdomain.com>

curl -s -o /dev/null -w "platform: %{http_code}\n" https://$SLUG.sites.curbsidesites.com/
curl -s -o /dev/null -w "custom:   %{http_code}\n" https://$DOMAIN/

# Invariant 9 — semantic, not just a 200. Their real phone must render.
curl -s https://$DOMAIN/ | grep -o '([0-9]\{3\}) [0-9]\{3\}-[0-9]\{4\}' | head -1

# Photos are real, not placeholders
curl -s https://$DOMAIN/ | grep -c 'blob.core.windows.net'

# The cert actually covers the hostname
echo | openssl s_client -connect $DOMAIN:443 -servername $DOMAIN 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
```

A 200 alone proves almost nothing — it is exactly what a wrong-tenant or
placeholder-image page returns. Check the phone number and the image host.

---

## Publishing images to production

Local sourcing populates the local DB and `.data/`. Production needs the files
in blob storage. Each slot's `meta.json` records `applied` (the chosen
candidate) and its `credit`, which is the recoverable source of truth if the
local DB is ever rebuilt.

```bash
source ~/.curbside-env-01
SLUG=<slug>

for f in .data/uploads/$SLUG/*.jpg; do
  slot=$(basename "$f" .jpg)
  az storage blob upload --account-name "$STORAGE_ACCOUNT" --auth-mode login \
    --container-name tenant-images --name "$SLUG/$slot.jpg" --file "$f" \
    --content-type image/jpeg \
    --content-cache-control "public, max-age=31536000, immutable" --overwrite
done
```

Then set `images.url` to
`https://$STORAGE_ACCOUNT.blob.core.windows.net/tenant-images/<slug>/<slot>.jpg`
and `images.credit` from the slot's `meta.json`. Blob names are stable per slot,
so a client can later drop in their own photo under the same name with no code
change. Pages pick the change up within the ISR window (10 min).

> The `~/.curbside-env-01` file is **zsh**. Scripts that source it must run
> under `zsh`, not `bash`, or they die at the `source` line with exit 127.

---

## Rollback

| Situation | Action |
|---|---|
| Site is wrong in public | Set `tenants.status = 'draft'` — custom domain stops resolving, platform URL still works |
| Domain misconfigured | `releaseDomain()` — deletes the custom hostname; client's DNS becomes inert |
| Bad content published | Set `content.published_at = NULL` |
| Client leaves | Release the domain first, then suspend — a suspended tenant serves the under-construction page, not a 404 |

Their domain is always theirs. Nothing here touches their registrar account.

---

## Known gaps

- **Cloudflare for SaaS is not enabled** — the five prerequisites above are
  outstanding, so no custom domain works yet. Everything through step 3 does.
- **Draft tenants leak content.** An anonymous request to a `draft` tenant's
  platform subdomain returns 404 with the tenant's business name, phone,
  services, and the owner's intake `voice` text still in the response body
  (Next streams the page before the layout's gate resolves). Slugs are
  guessable from business names. Queued as a Session A hardening item in
  `01-BUILD-PROMPT.md`. **Until it is fixed, treat a draft site as public** —
  don't put anything in intake you wouldn't show a competitor.
- **The Worker route is not the catch-all** — client domains won't route until
  `wrangler.toml` is restored to `*/*`.
- **Resend is not set up** (RUNBOOK Phase 8) — no automated client emails, so
  the DNS instructions and the verification chase must be sent by hand.
- **Stripe is deferred** (RUNBOOK Phase 9) — no billing on a "paying" client.
