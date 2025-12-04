-- Create trigger function to sync maintenance window status with linked job status
CREATE OR REPLACE FUNCTION public.sync_maintenance_window_status()
RETURNS TRIGGER AS $$
BEGIN
  -- When a job's status changes, check if it's linked to any maintenance window
  UPDATE maintenance_windows 
  SET 
    status = CASE 
      WHEN NEW.status = 'failed' THEN 'failed'
      WHEN NEW.status = 'cancelled' THEN 'cancelled'
      WHEN NEW.status = 'completed' THEN 'completed'
      WHEN NEW.status = 'running' THEN 'in_progress'
      ELSE status
    END,
    completed_at = CASE 
      WHEN NEW.status IN ('failed', 'completed', 'cancelled') THEN NOW()
      ELSE completed_at
    END,
    started_at = CASE 
      WHEN NEW.status = 'running' AND started_at IS NULL THEN NOW()
      ELSE started_at
    END,
    updated_at = NOW()
  WHERE NEW.id = ANY(job_ids);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on jobs table for status updates
DROP TRIGGER IF EXISTS sync_window_on_job_status_change ON jobs;
CREATE TRIGGER sync_window_on_job_status_change
  AFTER UPDATE OF status ON jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_maintenance_window_status();