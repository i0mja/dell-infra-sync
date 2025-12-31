-- Cancel stale scheduled_vcenter_sync and vcenter_sync jobs
UPDATE jobs 
SET status = 'cancelled',
    completed_at = NOW(),
    details = jsonb_set(
      COALESCE(details, '{}'::jsonb),
      '{cancellation_reason}',
      '"Auto-cancelled: HMAC authentication fix applied"'
    )
WHERE status IN ('pending', 'running')
AND (job_type::text = 'scheduled_vcenter_sync' OR job_type::text = 'vcenter_sync')
AND created_at < NOW() - INTERVAL '30 minutes';