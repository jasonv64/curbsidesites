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

## One-time platform setup — **ALL FIVE DONE as of 2026-07-19** (www.dubdating.com went live through them end to end)

Kept for rebuild-from-scratch reference. Custom domains need Cloudflare for
SaaS; until all five are done, the platform silently uses the **demo** hostname
provider and no real domain will connect.

- [x] **1. Enable Cloudflare for SaaS** on the `curbsidesites.com` zone.
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
- [x] **2. Set the fallback origin** to `sites-origin.curbsidesites.com`.
      That record already exists (`AAAA 100::`, proxied) and is what
      `CF_FALLBACK_ORIGIN` defaults to in `src/lib/adapters/cloudflare/live.ts`.
- [x] **3. Create a narrow API token** — permission `SSL and Certificates: Edit`
      on this zone only. **Not** the broad setup token from RUNBOOK Phase 6;
      this one is read by the running app and lives in Key Vault.
- [x] **4. Store it and set the zone id together** (see below).
- [x] **5. Restore the catch-all Worker route.** Done 2026-07-19 —
      `infra/cloudflare/wrangler.toml` now routes `*/*`. (While Cloudflare for
      SaaS was off, `*/*` was rejected and explicit `*.curbsidesites.com`
      patterns stood in — those do NOT match client domains. Do not revert
      while custom hostnames are live.)

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

### 4. Connect the domain — **PROVEN through hostname creation (2026-07-19)**

> Run against dubdating.com: `provisionDomain()` selected the live Cloudflare
> provider, created a real custom hostname (`pending_validation`, http DV),
> upserted the `domains` row to `pending`, and rendered GoDaddy instructions.
> What is still unproven is *verification* — the cert issuing after DNS is live
> — because that waits on the client's registrar + propagation.
>
> ⚠️ **APEX-CNAME LIMITATION — the generated instructions are wrong for an apex
> domain on GoDaddy.** `provisionDomain` emits `CNAME <apex> → sites-origin…`,
> but a CNAME cannot exist at a zone apex (RFC 1034) and GoDaddy has no CNAME
> flattening. So a client who wants `theirshop.com` (not `www.theirshop.com`)
> on GoDaddy cannot follow the instructions as written. Real options for an
> apex on a registrar without flattening:
>   - **Use `www.` as the custom hostname** (CNAME works for subdomains) and set
>     GoDaddy apex **Domain Forwarding** `theirshop.com → www.theirshop.com`.
>   - **Delegate the domain's nameservers to Cloudflare**, which flattens apex
>     CNAMEs — but then the client's DNS lives at Cloudflare, not their
>     registrar, which is a different arrangement than "keep your domain."
> The instruction generator should branch on apex-vs-subdomain and on whether
> the registrar supports flattening (Cloudflare/Namecheap yes, GoDaddy no).

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

### 5. Go live — **PROVEN (2026-07-19): www.dubdating.com is live end to end**

`maybeGoLive()` flips `draft → live` only when **the brand gate has passed AND
a domain has verified**, unless staff explicitly force it. Both conditions, or
it stays a draft. Verified on dub-dates: brand proposal approved (2.3 gate) +
`www.dubdating.com` verified → live, serving over its own TLS cert
(`CN=www.dubdating.com`), apex 301-forwarding to www.

> ⚠️ **The `*/*` Worker ate the ACME HTTP-01 challenge — fixed in the Worker,
> essential for every future client.** Cloudflare validates a custom hostname
> by serving a token at `http://<host>/.well-known/acme-challenge/…`. The
> zone-wide Worker intercepted that path and proxied it to Azure, so DV was
> stuck at `pending_validation` and returned Cloudflare `error 1001`. Fix:
> `worker.js` now passes `/.well-known/acme-challenge/` straight through
> (`return fetch(request)`) as the very first check. Without it, **no custom
> hostname using HTTP validation can ever go live behind this Worker.** (An
> alternative is TXT validation — `method: "txt"` in the CF adapter — which
> needs no Worker cooperation but adds a DNS record for the client.)

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

## Known gaps (reconciled 2026-08-04 — two earlier entries here were stale: Cloudflare for SaaS IS enabled and the `*/*` route IS restored, both proven by the 2026-07-19 go-live)

- ~~**Draft tenants leak content.**~~ **FIXED in code 2026-08-06** (Session 1,
  commit `26012dc`): the gate moved to `src/proxy.ts`, ahead of any render, and
  a gated draft is now byte-identical to a nonexistent host. Proven locally
  (zero tenant strings in the 404 body on `/`, `/services`, `/contact`; the
  preview-cookie path still renders in full) with a tripwire in the e2e suite.
  **Still deployed? No — pending the Session 1 production cutover (RUNBOOK
  11.5). Until that deploy lands, treat a draft site as public.**
- **The origin is publicly addressable** and honors forged `X-Forwarded-Host`
  (D23). **Fixed in code 2026-08-06** (commit `98e2601`, shared-secret header
  validated in `src/proxy.ts`) — **not yet deployed**; re-verified still
  exploitable against the bare FQDN on 2026-08-06 (forged header → 200,
  104,824 bytes). Closes with the same cutover.
- **Resend sending domain: CONFIRMED configured** (verified 2026-08-06 by DNS,
  replacing this file's earlier "not set up"): `send.curbsidesites.com` carries
  `v=spf1 include:amazonses.com ~all` plus Resend's `feedback-smtp` MX,
  `resend._domainkey.curbsidesites.com` has a DKIM key, and DMARC is present
  (`p=none`). Note the apex SPF is Outlook-only — mail from Resend aligns via
  DKIM, not SPF, which DMARC accepts. **Still unverified: whether the app's
  `email` integration is actually flipped live in production** rather than
  serving demo. Check before relying on chase/instruction emails:
  `curl -H "Authorization: Bearer $STAFF_STATUS_TOKEN" https://<fqdn>/api/status`
  plus `synthetic_checks` where `kind='form_delivery'`.
- **Stripe is deferred** (RUNBOOK Phase 9) — no billing on a "paying" client.
  The billing build is `02-BUILD-PROMPT.md` Session 2.
- **dubdating.com is a test fixture, not a client (D21)** — it is currently
  live and indexable with placeholder NAP; `noindex` is queued in
  `02-BUILD-PROMPT.md` Session 1.
