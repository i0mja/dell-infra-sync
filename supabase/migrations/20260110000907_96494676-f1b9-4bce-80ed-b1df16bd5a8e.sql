-- Backfill last_test_at from completed test failovers
UPDATE protection_groups pg
SET last_test_at = subquery.latest_rollback
FROM (
  SELECT 
    fe.protection_group_id,
    MAX(fe.rolled_back_at) as latest_rollback
  FROM failover_events fe
  WHERE fe.failover_type = 'test'
    AND fe.status = 'rolled_back'
    AND fe.rolled_back_at IS NOT NULL
  GROUP BY fe.protection_group_id
) subquery
WHERE pg.id = subquery.protection_group_id
  AND (pg.last_test_at IS NULL OR pg.last_test_at < subquery.latest_rollback);