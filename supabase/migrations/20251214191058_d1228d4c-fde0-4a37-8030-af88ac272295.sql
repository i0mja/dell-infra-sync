-- Reset bytes_transferred to 0 for old jobs that used dataset size fallback
-- (Only for completed jobs before the fix was deployed - Dec 14, 2025)
UPDATE replication_jobs 
SET bytes_transferred = 0
WHERE status = 'completed'
  AND created_at < '2025-12-14T19:00:00Z'
  AND bytes_transferred > 0;

-- Also mark these as corrected in details
UPDATE replication_jobs 
SET details = jsonb_set(
  COALESCE(details, '{}'::jsonb),
  '{bytes_data_corrected}',
  '"true"'::jsonb
)
WHERE status = 'completed'
  AND created_at < '2025-12-14T19:00:00Z';