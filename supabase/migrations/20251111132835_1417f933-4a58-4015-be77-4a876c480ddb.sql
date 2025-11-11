-- Add stale job detection settings to activity_settings
ALTER TABLE activity_settings 
ADD COLUMN IF NOT EXISTS stale_pending_hours INTEGER DEFAULT 24,
ADD COLUMN IF NOT EXISTS stale_running_hours INTEGER DEFAULT 48,
ADD COLUMN IF NOT EXISTS auto_cancel_stale_jobs BOOLEAN DEFAULT TRUE;

-- Update cleanup_old_jobs function to handle stale job cancellation
CREATE OR REPLACE FUNCTION public.cleanup_old_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  settings_record RECORD;
  cutoff_date TIMESTAMPTZ;
  stale_pending_cutoff TIMESTAMPTZ;
  stale_running_cutoff TIMESTAMPTZ;
BEGIN
  -- Get settings
  SELECT * INTO settings_record FROM activity_settings LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Auto-cancel stale jobs if enabled
  IF settings_record.auto_cancel_stale_jobs THEN
    -- Calculate cutoff times for stale jobs
    stale_pending_cutoff := NOW() - (settings_record.stale_pending_hours || ' hours')::INTERVAL;
    stale_running_cutoff := NOW() - (settings_record.stale_running_hours || ' hours')::INTERVAL;
    
    -- Cancel jobs stuck in pending state
    UPDATE jobs 
    SET status = 'cancelled', 
        completed_at = NOW(),
        details = jsonb_set(
          COALESCE(details, '{}'::jsonb),
          '{cancellation_reason}',
          to_jsonb('Auto-cancelled: stuck in pending state for >' || settings_record.stale_pending_hours || ' hours')
        )
    WHERE status = 'pending' 
      AND created_at < stale_pending_cutoff;
    
    -- Cancel jobs stuck in running state
    UPDATE jobs 
    SET status = 'cancelled',
        completed_at = NOW(),
        details = jsonb_set(
          COALESCE(details, '{}'::jsonb),
          '{cancellation_reason}',
          to_jsonb('Auto-cancelled: stuck in running state for >' || settings_record.stale_running_hours || ' hours')
        )
    WHERE status = 'running' 
      AND started_at < stale_running_cutoff;
  END IF;
  
  -- Delete old completed/failed/cancelled jobs if auto cleanup enabled
  IF settings_record.job_auto_cleanup_enabled THEN
    cutoff_date := NOW() - (settings_record.job_retention_days || ' days')::INTERVAL;
    
    -- Delete old completed/failed/cancelled jobs and their tasks
    DELETE FROM job_tasks 
    WHERE job_id IN (
      SELECT id FROM jobs 
      WHERE status IN ('completed', 'failed', 'cancelled')
      AND completed_at < cutoff_date
    );
    
    DELETE FROM jobs 
    WHERE status IN ('completed', 'failed', 'cancelled')
    AND completed_at < cutoff_date;
  END IF;
  
  -- Update last cleanup timestamp
  UPDATE activity_settings SET job_last_cleanup_at = NOW();
END;
$function$;