-- Create atomic RPC function for reliable job completion
-- This replaces the read-modify-write pattern with a single atomic update

CREATE OR REPLACE FUNCTION public.complete_replication_job(
  p_job_id UUID,
  p_status TEXT,
  p_vms_synced INTEGER,
  p_total_vms INTEGER,
  p_bytes_transferred BIGINT,
  p_current_step TEXT DEFAULT 'Complete',
  p_errors JSONB DEFAULT '[]'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE jobs
  SET 
    status = p_status::job_status,
    completed_at = NOW(),
    details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
      'vms_synced', p_vms_synced,
      'total_vms', p_total_vms,
      'bytes_transferred', p_bytes_transferred,
      'current_step', p_current_step,
      'progress_percent', 100,
      'errors', p_errors
    )
  WHERE id = p_job_id
    AND status = 'running';  -- Only update if still running (idempotent)
  
  RETURN FOUND;
END;
$$;

-- Update auto_complete_stale_replication_jobs to extract VM counts from console logs
CREATE OR REPLACE FUNCTION public.auto_complete_stale_replication_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  job_record RECORD;
  updated_count INTEGER := 0;
  job_ids TEXT[] := ARRAY[]::TEXT[];
  extracted_synced INTEGER;
  extracted_total INTEGER;
  console_text TEXT;
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
    -- Try to extract VM counts from console log
    console_text := job_record.details->>'console_log';
    extracted_synced := NULL;
    extracted_total := NULL;
    
    -- Try pattern: "Sync complete: X/Y VMs synced" or "X/Y VMs synced"
    IF console_text ~ '(\d+)/(\d+)\s*VMs?\s*synced' THEN
      extracted_synced := (regexp_match(console_text, '(\d+)/(\d+)\s*VMs?\s*synced'))[1]::int;
      extracted_total := (regexp_match(console_text, '(\d+)/(\d+)\s*VMs?\s*synced'))[2]::int;
    -- Try pattern: "All X VMs synced"
    ELSIF console_text ~ 'All\s+(\d+)\s+VMs?\s+synced' THEN
      extracted_synced := (regexp_match(console_text, 'All\s+(\d+)\s+VMs?\s+synced'))[1]::int;
      extracted_total := extracted_synced;
    END IF;
    
    -- Use extracted values or fall back to existing details
    UPDATE jobs
    SET 
      status = 'completed',
      completed_at = NOW(),
      details = job_record.details || jsonb_build_object(
        'progress_percent', 100,
        'current_step', 'Complete (auto-recovered)',
        'recovered_at', NOW()::text,
        'recovery_reason', 'Auto-completed by scheduled recovery - console/details indicated completion',
        'vms_synced', COALESCE(extracted_synced, (job_record.details->>'vms_synced')::int, 0),
        'total_vms', COALESCE(extracted_total, (job_record.details->>'total_vms')::int, 0)
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