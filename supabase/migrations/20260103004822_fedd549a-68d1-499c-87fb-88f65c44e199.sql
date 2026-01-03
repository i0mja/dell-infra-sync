-- Function to auto-complete stale replication jobs
-- This is a defense-in-depth mechanism for jobs where the executor completed
-- the sync but failed to update the job status to 'completed'
CREATE OR REPLACE FUNCTION public.auto_complete_stale_replication_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job_record RECORD;
  updated_count INTEGER := 0;
  job_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR job_record IN
    SELECT id, details
    FROM jobs
    WHERE 
      job_type = 'run_replication_sync'
      AND status = 'running'
      AND started_at < NOW() - INTERVAL '5 minutes'
      AND (
        -- Console indicates completion via various patterns
        details->>'console_log' ~* 'Sync complete.*VMs synced'
        OR details->>'console_log' ~* 'Transfer complete'
        OR details->>'console_log' ~* 'Verified snapshot on Site B'
        OR details->>'console_log' ~* 'All.*VMs synced'
        -- Or details indicate all VMs are synced
        OR (
          (details->>'vms_synced')::int > 0 
          AND (details->>'vms_synced')::int >= COALESCE((details->>'total_vms')::int, 1)
        )
      )
  LOOP
    UPDATE jobs
    SET 
      status = 'completed',
      completed_at = NOW(),
      details = job_record.details || jsonb_build_object(
        'progress_percent', 100,
        'current_step', 'Complete (auto-recovered)',
        'recovered_at', NOW()::text,
        'recovery_reason', 'Auto-completed by scheduled recovery - console/details indicated completion'
      )
    WHERE id = job_record.id;
    
    job_ids := array_append(job_ids, job_record.id::text);
    updated_count := updated_count + 1;
  END LOOP;
  
  RETURN jsonb_build_object(
    'updated_count', updated_count,
    'job_ids', job_ids,
    'executed_at', NOW()
  );
END;
$$;

-- Schedule to run every 2 minutes via pg_cron
SELECT cron.schedule(
  'auto-complete-stale-replication-jobs',
  '*/2 * * * *',
  'SELECT public.auto_complete_stale_replication_jobs()'
);