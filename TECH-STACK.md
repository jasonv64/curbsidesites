# TECH-STACK.md

**Curbside Sites — Technology Stack & Architecture Reference**

This is a living reference guide for developers. It describes the current technology choices, their purposes, and how they fit together. For *why* these choices were made, see `ARCHITECTURE.md` (decisions D1–D28). For *how to operate* the system, see `RUNBOOK.md`.

---

## 1. FRAMEWORK & LANGUAGE

| Component | Version | Purpose |
|---|---|---|
| **Next.js** | 16.2.10 | Full-stack React framework; App Router, server components, middleware |
| **React** | 19.2.4 | UI library |
| **TypeScript** | 5.x | Language; strict mode, type safety across the app |
| **tsx** | 4.23.0 | TypeScript executor for scripts and CLI tasks |

**Key characteristics:**
- App Router (not Pages Router)
- Server-side rendering for tenant app pages
- Server actions for form submissions (intake, portal)
- Middleware (`src/proxy.ts`) for request routing

---

## 2. INFRASTRUCTURE & CLOUD

### Compute & Hosting
| Component | Service | Purpose |
|---|---|---|
| **Application runtime** | Azure Container Apps | Stateless, multi-tenant Next.js app |
| **Region** | West US 3 | Must match database region (RUNBOOK 1.2) |

### Secrets & Identity
| Component | Service | Purpose |
|---|---|---|
| **Secrets storage** | Azure Key Vault | API keys, database passwords, integration credentials |
| **Authentication** | Azure Managed Identity | Passwordless access from app → Key Vault (no connection strings in env) |

### Object Storage
| Component | Service | Purpose |
|---|---|---|
| **Image uploads** | Azure Blob Storage | Client logos, onboarding photos, generated report PDFs |
| **Failover snapshots** | Azure Blob Storage | Cached tenant snapshots for recovery |

### CDN / Edge / DNS
| Component | Service | Purpose |
|---|---|---|
| **CDN** | Cloudflare | Global edge caching, request optimization |
| **WAF / DDoS** | Cloudflare | Web application firewall, bot protection |
| **DNS** | Cloudflare | Domain routing, authoritative DNS |
| **Per-tenant TLS** | Cloudflare for SaaS (Custom Hostnames) | Auto-provisions and auto-renews TLS certs for customer domains |
| **Edge Worker** | Cloudflare Workers | Validates `X-Forwarded-Host` header before Origin (D23) |

---

## 3. DATABASE

### PostgreSQL
| Component | Service | Purpose |
|---|---|---|
| **Database** | Azure Database for PostgreSQL — Flexible Server | Relational DB with Row-Level Security |
| **Tier** | Burstable (B1ms → B2s) | Cost-optimized for variable load |
| **Version** | 15+ | RLS support, JSONB, native functions |

### Roles & Row-Level Security (RLS)
| Role | Purpose | Isolation |
|---|---|---|
| `curbside_admin` | Migrations, seeding, staff scripts | Bypasses RLS (owner role) |
| `curbside_app` | Public tenant app (reads/writes) | RLS-bound via `tenant_id` |
| `curbside_control` | Control plane & staff (onboarding, admin) | RLS-bound via policy |

**Key invariant:** Every query sets `SET LOCAL tenant_context = <id>` before operating. A session-level `SET` leaks tenant A's data into tenant B's queries.

### Data Model Overview
| Table | Purpose | Key Columns |
|---|---|---|
| **tenants** | Tenant identity | `id`, `slug`, `business_name`, `status` (draft/live), `plan_tier`, `features` (JSON flags), `preview_token` |
| **business_profile** | NAP + hours + socials | `tenant_id`, `nap` (JSON), `hours` (JSON), `socials` (JSON), `service_area` (array), `schema_subtype`, `voice_notes` |
| **services** | Services offered | `tenant_id`, `slug`, `name`, `blurb`, `sort_order` |
| **brand** | Live brand tokens | `tenant_id`, `tokens` (JSON: colors, fonts), `font_pairing_key`, `logo_url` |
| **brand_proposals** | Draft proposals during onboarding | `tenant_id`, `tokens`, `font_pairing_key`, `notes` |
| **sections** | Page layout (homecoming) | `tenant_id`, `page`, `section_name`, `sort_order`, `props` (JSON) |
| **images** | Image manifest | `tenant_id`, `slot_id`, `purpose`, `search_query`, `aspect`, `alt`, `url`, `credit` |
| **integrations** | Third-party state | `tenant_id`, `key` (reviews_google, payments, booking, etc.), `mode` (demo/live), `kv_secret_ref` |
| **domains** | Customer domains | `tenant_id`, `hostname`, `is_primary`, `registrar`, `verification_status` |
| **onboarding_calls** | Kickoff call scheduling | `tenant_id`, `scheduled_at` |
| **intake_submissions** | Intake form payloads | `tenant_id`, `payload` (JSON), `ip` |
| **consents** | Legal agreements | `tenant_id`, `kind` (terms_of_service, call_recording_ai), `source`, `consent_text` |
| **events** | Tenant-scoped events | `tenant_id`, `kind`, `data` (JSON) |
| **content** | Blog posts, custom content | `tenant_id`, `type`, `slug`, `title`, `body`, `published_at` |

**See `migrations/` for DDL.** Schema evolves; read the latest migration for the source of truth.

---

## 4. UI / FRONTEND

### Styling
| Tool | Purpose |
|---|---|
| **Tailwind CSS** | 4.x; utility-first CSS framework |
| **`@tailwindcss/postcss`** | PostCSS integration |
| **PostCSS** | CSS processing pipeline |

### Component Architecture
| Layer | Purpose | Location |
|---|---|---|
| **Sections** | Reusable page sections (Hero, Services, Reviews, etc.) | `src/components/sections/` |
| **Section Registry** | Declarative section mapping with Zod validation | `src/lib/section-registry.tsx` |
| **Forms** | Form components (intake, quote, newsletter) | `src/components/forms/` |
| **Portal** | Client-facing admin surfaces | `src/components/portal/` |
| **Site components** | Shared UI primitives | `src/components/site/` |

**Key pattern:** Each section is safe to enable in any order with any data. Empty data degrades gracefully; nothing renders broken.

### Markdown
| Tool | Purpose |
|---|---|
| **react-markdown** | Render markdown to JSX |
| **remark-gfm** | GitHub-flavored markdown support |

---

## 5. TESTING

### Unit Tests
| Tool | Purpose |
|---|---|
| **Vitest** | 4.x; unit test runner |
| **Test files** | `tests/*.test.ts` |

**Key tests:**
- `tests/rls-isolation.test.ts` — Verifies Row-Level Security isolation (8/8 tests)
- `tests/growth-scheduler.test.ts` — Growth plane scheduler
- `tests/nap-invariant.test.ts` — NAP consistency checking
- `tests/growth-quota.test.ts` — Usage quota enforcement

**Run:** `npm run test:rls`, `npm run test:growth`

### End-to-End Tests
| Tool | Purpose |
|---|---|
| **Playwright** | 1.61.1; browser automation |
| **@axe-core/playwright** | Accessibility testing (WCAG compliance) |
| **Test files** | `e2e/*.spec.ts` (via Playwright config) |

**Run:** `npm run test:e2e`

**CI status:** ⚠️ Currently failing on axe/lifecycle e2e step (D24 — fix as first exit criterion of next session).

---

## 6. THIRD-PARTY SERVICES

### Images & Content
| Service | API | Purpose | Auth | Cost |
|---|---|---|---|---|
| **Unsplash** | REST | Stock photos for placeholder image slots | App ID + Access Key | Free tier (50 requests/hour) |
| **Stable Diffusion** | (deferred) | AI image generation for custom content | — | Planned for future |

**Current setup:** Unsplash credentials in `.env.local` (should move to `.curbside-env-01` for production).

### Email (Transactional)
| Service | Purpose | Auth | Configuration |
|---|---|---|---|
| **Resend** | Intake receipts, onboarding notifications | API key | Per-domain SPF/DKIM/DMARC required (§6, RUNBOOK) |

### Analytics
| Service | Purpose | Auth | Model |
|---|---|---|---|
| **Plausible** | Cookieless analytics dashboard | Site ID + API token | Self-reported conversions; also writes to `events` table |

### Customer Reviews
| Service | API | Purpose | Auth |
|---|---|---|---|
| **Google Places API (v1)** | REST | Extract Google reviews | API key in Key Vault |
| **Yelp Fusion API** | REST | Extract Yelp reviews | Client credentials in Key Vault |

### Payments & Billing
| Service | Purpose | Integration | Auth |
|---|---|---|---|
| **Stripe Billing** | Subscription management, invoicing, dunning | Webhooks (ingest + processing) | API keys in Key Vault |

**Status:** Platform cannot bill a client today (Session 2 incomplete — see `02-BUILD-PROMPT.md` state).

### AI / LLM
| Service | Purpose | Models | Auth |
|---|---|---|---|
| **Anthropic API** | Change-request parsing, content drafting, quote assistant | Claude 3.5 Sonnet (or latest) | API key in Key Vault |

### Booking (Future)
| Service | Purpose | Status |
|---|---|---|
| **Calendly / Cal.com** | Appointment scheduling embed | Deferred (D9) |

### SMS (Future)
| Service | Purpose | Status | Blocker |
|---|---|---|---|
| **Twilio** | SMS notifications, alerts | Deferred | Awaiting A2P 10DLC approval |

---

## 7. DEVELOPMENT & OPERATIONS

### Package Management
| Tool | Purpose |
|---|---|
| **npm** | Node.js package manager |
| **node_modules/next/** | Built-in Next.js docs at `node_modules/next/dist/docs/` (read before writing code) |

### Database Scripts
| Script | Purpose |
|---|---|
| `npm run db:migrate` | Apply migrations (owner role) |
| `npm run db:seed` | Seed base data (demo tenants, sections) |
| `npm run db:seed:fleet` | Create fleet of test tenants |
| `npm run db:seed:growth` | Seed growth plane demo data |

### Build & Deployment
| Command | Purpose |
|---|---|
| `npm run dev` | Start Next.js dev server (localhost:3000) |
| `npm run build` | Production build |
| `npm run start` | Start production server (after build) |
| `npm run verify` | Full verification (build + tests + e2e) |

### Utilities
| Script | Purpose | Trigger |
|---|---|---|
| `npm run jobs` | Run background jobs (growth scheduler, review fetches) | Cron or manual |
| `npm run export:static` | Generate static snapshots for failover | Daily cron |
| `npm run snapshots:upload` | Upload failover snapshots to Blob Storage | Post-export |
| `npm run fetch:reviews` | Fetch Google/Yelp reviews for all active tenants | Growth scheduler |
| `npm run images:source` | Populate image slots from Unsplash | Onboarding, manual refill |
| `npm run report` | Generate monthly client report | Monthly job |
| `npm run stripe:simulate` | Simulate Stripe webhook events (dev) | Testing |
| `npm run staff:create` | Create staff accounts (admin role) | Onboarding |
| `npm run fetch:instagram` | Pull Instagram posts into `content` table | Growth scheduler |

### Code Quality
| Tool | Purpose | Run |
|---|---|---|
| **ESLint** | Code linting (9.x) | `npm run lint` |
| **TypeScript** | Type checking (strict mode) | `npm run build` / IDE |

### Environment Configuration
| File | Purpose | Owner |
|---|---|---|
| `.env.local` | Local dev env (database URLs, demo API keys) | Development only |
| `.curbside-env-01` | Production env (Azure resources, secrets) | Sourced by deployment |

---

## 8. KEY ARCHITECTURE CONCEPTS

### Multi-Tenancy
- **One codebase, N tenants.** No per-client repos or forks.
- **Tenant resolved at request time** from `Host` header (via `src/proxy.ts`).
- **Config-driven:** Code in Git, content/business data in PostgreSQL (D2).
- **RLS-enforced isolation:** Every query automatically scoped to `tenant_id` via PostgreSQL policies.

### Section Registry & Template System
- **Sections** are reusable page components registered in `src/lib/section-registry.tsx`.
- **Each section** declares its props schema (Zod) and a React component.
- **Tenants configure layout** via `sections` database rows (page, sort_order, props).
- **Safe composition:** Empty data renders gracefully; no broken layouts.
- **Adding a section:** Register component + schema; instantly available to all tenants.

### Content Propagation
- **Single source of truth:** The `tenants` / `business_profile` row.
- **Everything derives from it:** Header, footer, sitemap, JSON-LD, OG images, `llms.txt`.
- **Hardcoding in components is forbidden** — client portal, change-request chat, and onboarding form all need to write business data without code deploys.

### Brand & Design Tokens
- **Brand row** holds live design tokens (colors, fonts, logo URL).
- **Brand proposal row** holds draft proposals during onboarding.
- **Font pairings** are pre-computed and keyed (`src/lib/font-pairings.ts`).
- **Logo & brand colors** are extracted during onboarding from uploaded logos or AI-generated proposals.

### Image Management
- **Image manifest** (`images` table) declares slots, purposes, search queries, aspect ratios.
- **Placeholder system:** Branded placeholders render if `url` is NULL (nothing 404s, D11).
- **Unsplash integration:** Images sourced on-demand or manually filled.
- **User uploads:** Logos and photos from intake form land in Azure Blob Storage under tenant slug.

### Feature Flags & Integrations
- **Feature flags** (D19) come directly from intake form checkboxes; stored in `tenants.features` (JSON).
- **Integration modes:** `demo` (stub endpoints) or `live` (real credentials); gate features at render time.
- **Secrets reference:** Each integration stores a `kv_secret_ref` pointing to Key Vault name; the app fetches at runtime.

### Onboarding Pipeline
1. **Intake form submission** → Server action `submitIntake`
2. **Validation** (Zod) + **brand proposal** (AI-generated or logo-extracted)
3. **Transaction:** Create tenant + business_profile + services + brand + images + integrations + consents + domain intent
4. **Upload attachment:** Logo → brand row; photos → gallery slots (happens after transaction, uses final slug)
5. **Preview link:** Tenant accessible at `<slug>.<apex>?preview=<token>` immediately
6. **Notification:** Intake receipt emailed; staff notified; call auto-booked

---

## 9. REQUEST FLOW (Simplified)

```
GET https://ironridgeoffroad.com/services

  ↓

[Cloudflare edge]
  - Validates X-Forwarded-Host header via Worker
  - Passes request to origin (Azure Container Apps)

  ↓

[src/proxy.ts — Next.js middleware]
  - Extracts Host header
  - Handles preview token → cookie handshake
  - Rewrites to /s/[host]/services

  ↓

[src/app/s/[host]/layout.tsx]
  - Resolves tenant from database (slug → tenant record)
  - Enforces preview-token gate (if draft)
  - Sets tenant context for RLS

  ↓

[src/app/s/[host]/services/page.tsx]
  - Queries tenant's sections for this page
  - Renders each section (from registry) with props + data
  - Populates image slots (Unsplash or user uploads)
  - Populates brand tokens (colors, fonts)

  ↓

[Browser]
  - Cached at Cloudflare edge if not preview-gated
  - Styled with Tailwind CSS
  - Accessible (WCAG 2.1, tested with Axe)
```

---

## 10. DEPLOYMENT & MONITORING

### Deployment
- **Code:** Docker image built and pushed to Azure Container Registry.
- **Orchestration:** Azure Container Apps (scales on CPU/memory).
- **Secrets:** Fetched from Key Vault at startup via Managed Identity.
- **Database:** Migrations run as job before app startup.

### Failover
- **Static snapshots** (HTML + CSS) generated daily and stored in Blob Storage.
- **Served if origin is down** (configured in Cloudflare Worker fallback).

### Error Tracking
- **Sentry** (configured but not yet wired — ASSUMPTIONS #77).
- **Interim:** Azure Monitor + in-app alarms + edge Worker failover emails.

### Observability
- **Logs:** Azure Monitor, searchable by `tenant_id`.
- **Analytics:** Plausible (visitor analytics); Curbside `events` table (conversion tracking).
- **Monitoring:** Monthly report generation for clients; staff dashboard (not yet built).

---

## 11. KNOWN CONSTRAINTS & GOTCHAS

1. **Database region must match app region.** Changing one without the other causes perf issues.
2. **Next.js breaking changes — read the docs.** This version has breaking changes vs. training data. Read `node_modules/next/dist/docs/` before writing code.
3. **RLS is per-session, not per-query.** Always `SET LOCAL tenant_context` before a query; session-level `SET` leaks data.
4. **Hardcoding config in components breaks the propagation guarantee.** NAP, hours, services, etc. must always derive from the database row.
5. **Brand tokens must always exist** (never NULL). Render gracefully; never skip a color or font because the row doesn't have it.
6. **Draft content is preview-token-only, not public.** Unauthenticated requests to draft tenants must 403 with no content leakage (D6 — currently being fixed in Session 1).
7. **X-Forwarded-Host is untrusted from the internet.** Validated by Cloudflare Worker before reaching the origin (D23 — currently being hardened in Session 1).
8. **Stripe is not wired for auto-billing.** Sessions 2 carry forward the incomplete deposit collection and subscription creation flows.

---

## 12. FURTHER READING

- **Decisions & invariants:** `ARCHITECTURE.md`
- **Build specifications:** `SPECS.md` (Parts I–III: tenant app, control plane, growth plane)
- **Operations:** `RUNBOOK.md` (deployments, failover, secrets, costs, calendar)
- **Forward build plan:** `02-BUILD-PROMPT.md` (sessions, sequencing, exit criteria)
- **Working assumptions:** `ASSUMPTIONS.md` (logged, dispositioned)
- **Per-client procedure:** `ONBOARDING.md`
- **Code-level conventions:** `README.md`
