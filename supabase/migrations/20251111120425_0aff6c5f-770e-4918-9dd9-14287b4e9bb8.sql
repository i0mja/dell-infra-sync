-- Fix search_path for cleanup_old_jobs function
DROP FUNCTION IF EXISTS public.cleanup_old_jobs();

CREATE OR REPLACE FUNCTION public.cleanup_old_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings_record RECORD;
  cutoff_date TIMESTAMPTZ;
BEGIN
  -- Get settings
  SELECT * INTO settings_record FROM activity_settings LIMIT 1;
  
  IF NOT FOUND OR NOT settings_record.job_auto_cleanup_enabled THEN
    RETURN;
  END IF;
  
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
  
  -- Update last cleanup timestamp
  UPDATE activity_settings SET job_last_cleanup_at = NOW();
END;
$$;