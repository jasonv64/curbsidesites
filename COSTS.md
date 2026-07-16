# COSTS.md — what the infrastructure actually costs

Monthly, USD, `westus3`, pay-as-you-go list prices as of July 2026 —
sanity-checked against the Azure pricing page, but prices drift: treat
anything within ±20% as "as expected" and re-price in the Azure calculator
before making a decision that hinges on a single line.

Three scales: **3 tenants** (this weekend), **50** (~$17k MRR at the D19
blended average), **200** (~$69k MRR). The pattern to notice before the
tables: infrastructure stays around **1–2% of MRR at every scale**. Nothing
here is ever the business's problem — D19 said it first: the hard part was
never the code, and it isn't the hosting bill either.

## The bill, itemized

| Service | 3 tenants | 50 tenants | 200 tenants |
|---|---|---|---|
| **Azure Postgres Flexible** | **B1ms** (1 vCPU/2 GiB) + 32 GB ≈ **$17** | **B2s** (2 vCPU/4 GiB) + 64 GB ≈ **$57** | **GP D2ds_v5** (2 vCPU/8 GiB) + 128 GB, **zone-redundant HA** ≈ **$300** |
| **Azure Container Apps** (consumption) | 1× 1 vCPU/2 GiB, min-replicas 1, mostly idle-billed ≈ **$35** | 2 replicas, busier duty cycle ≈ **$110** | 3–5 replicas ≈ **$300** |
| ACA cron jobs (tick + nightly export) | ≈ $2 | ≈ $4 | ≈ $8 |
| **Azure Container Registry** | Basic **$5** | Basic $5 (with image purging — see breakpoints) | Standard **$20** |
| **Azure Key Vault** | ~$0 (per-10k-ops pricing; the 5-min cache keeps ops tiny) | ~$1 | ~$3 |
| **Azure Blob Storage** (LRS) | <$1 | ~$5 | ~$20 |
| Azure Monitor + Log Analytics | ~$2 | ~$15 | ~$50 |
| **Cloudflare** zone | Free plan $0 | $0 | $0 |
| Cloudflare **ACM** (the `*.sites.` wildcard cert) | **$10** | $10 | $10 |
| Cloudflare **for SaaS** custom hostnames | $0 (first 100 free) | $0 | 100 over free × $0.10 = **$10** |
| Cloudflare **Workers** (the edge router) | Free tier $0 | Paid **$5** (free tier's 100k req/day runs out ~here) | $5 + ~$5 overage |
| **Resend** | Free (3k emails/mo) | Pro **$20** | Scale **$90** |
| **Plausible** (only if/when sold — Curb+ feature) | $0 | ~$19 (100k views) | ~$69 (1M views) |
| **Anthropic API** (content drafts, change-request parsing) | ~$10 | ~$60 | ~$250 |
| **Sentry** (D3 — not yet wired, ASSUMPTIONS #77) | $0 | Team ~$26 | ~$80 |
| Domain (curbsidesites.com) | ~$1 (≈$10/yr) | $1 | $1 |
| **Total** | **≈ $85/mo** | **≈ $340/mo** | **≈ $1,150/mo** |
| As % of MRR (D19 blend ≈ $346/tenant) | 8% of $1,038 | 2.0% | 1.7% |

Not in this bill, deliberately: **Stripe fees** (per-transaction: ~0.8%
capped at $5 on ACH — the reason ACH is the D7 default — vs 2.9% + 30¢ on
cards: at 200 tenants that's roughly **$800/mo card vs $170/mo ACH**, the
single biggest "infra" number on this page if you let clients default to
cards); **Twilio** (deferred behind A2P, see CALENDAR.md — brand $44
one-time, ~$16/mo per campaign when it ships); stock-photo API keys (free
tiers); and your laptop.

## What breaks first at each scale — and the move

**Leaving 3 → ~15 tenants: the database connection budget.**
B1ms allows ~50 connections. The app pool + control pool + two cron jobs
fit; the moment ACA scales to a second replica (each replica brings both
pools), or you run tests against prod while the tick fires, you'll see
`remaining connection slots are reserved`. That error looks like an outage
but is a SKU line: **move to B2s** (`az postgres flexible-server update
--sku-name Standard_B2s` — minutes of downtime, do it at night, snapshot
first). Watch: the `pg-cpu-90` alert also fires when B-series **burst
credits** run dry under sustained load — same move.

**Leaving ~50: three at once.**
1. **Burstable → General Purpose Postgres.** Not for speed — for **HA**.
   Burstable doesn't support zone-redundant high availability, and at 50
   paying care-plans "the DB VM rebooted for 4 minutes" stops being
   acceptable. D2ds_v5 + HA roughly quintuples the DB line; that's what the
   9× MRR growth was for. Do the **VNet integration** move in the same
   maintenance window (RUNBOOK 2.1 called this shot) — the allow-azure
   firewall rule was a solo-operator convenience, not an end state.
2. **The single replica.** At 2+ replicas two Session-1 assumptions
   surface: the in-memory rate limiter becomes per-replica (ASSUMPTIONS
   #17 — honeypot+Zod still hold the line) and the ISR cache splits
   (more DB reads; harmless). Nothing to build yet; know it's why the
   numbers moved.
3. **Workers free tier** (100k req/day ≈ 1.2 req/s average) — the router
   dies with a 1015/1027 error page when exhausted. $5/mo fixes it;
   turn it on *before* 50 tenants, not after the first throttled evening.

**Leaving ~200: nothing on this page.**
The stack as designed carries 200 comfortably (that was D1's whole
premise). What actually strains: **ACR Basic's 10 GB** fills after ~5
two-GB image versions — either `az acr repository delete` old tags in the
deploy ritual or go Standard; **Log Analytics** starts charging real money
for chatty logs — cap retention at 30 days; **Yelp/Google review quotas**
— already engineered around (staggering + `vendor_quotas`, GROWTH Part 2),
just raise `QUOTA_<VENDOR>_PER_DAY` if you buy higher tiers; and the
monthly **report PDF generation** burst on the 2nd (200 chromium renders —
the stagger spreads them over 4 days by design). The genuine constraint at
200 was stated in D19 and it isn't rentable: acquisition.

## Cost hygiene rules

1. **One region, forever** (D15). Cross-region egress between app and DB
   would dwarf every optimization on this page.
2. **Min-replicas 1, not 2**, until real traffic says otherwise — the edge
   Worker + static failover (D6) is the availability story at small scale,
   and it's already paid for.
3. **Never** leave `az postgres flexible-server` HA on at Burstable scale
   experiments — it silently doubles the DB bill and Burstable doesn't
   honor it anyway.
4. Delete ACR tags older than the last 3 — your rollback vocabulary
   (RUNBOOK 11) never reaches deeper than that.
5. Re-read this file when tenant #30 signs; the 50-tenant column stops
   being hypothetical inside a quarter at that pace.
