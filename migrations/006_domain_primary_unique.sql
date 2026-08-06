-- Session 1 (02-BUILD-PROMPT): a tenant can never hold two primary domains —
-- constraint, not convention.
--
-- The dub-dates apex→www swap left TWO is_primary rows (releaseDomains marked
-- the apex 'released' but never cleared is_primary), and the nightly export's
-- unordered `WHERE d.is_primary LIMIT 1` then non-deterministically grabbed
-- the dead released apex, staling the failover snapshots for a week.
--
-- Order matters: repair existing data, then add the index that makes the
-- state unrepresentable.

-- 1. A released domain is never primary.
UPDATE domains SET is_primary = false
 WHERE is_primary AND verification_status = 'released';

-- 2. Defensive dedupe for any tenant still holding several primaries: keep
--    the most recently verified (unverified rows lose ties), demote the rest.
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY tenant_id
           ORDER BY verified_at DESC NULLS LAST, created_at DESC
         ) AS rn
    FROM domains WHERE is_primary
)
UPDATE domains SET is_primary = false
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3. The constraint.
CREATE UNIQUE INDEX domains_one_primary_per_tenant
  ON domains (tenant_id) WHERE is_primary;
