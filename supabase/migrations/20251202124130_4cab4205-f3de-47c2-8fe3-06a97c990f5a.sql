-- Add priority and notes columns to jobs table for job management
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add index for priority-based sorting
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON public.jobs(priority);

-- Add constraint using trigger for valid priority values
CREATE OR REPLACE FUNCTION public.validate_job_priority()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.priority IS NOT NULL AND NEW.priority NOT IN ('low', 'normal', 'high', 'critical') THEN
    RAISE EXCEPTION 'Invalid priority value: %. Must be one of: low, normal, high, critical', NEW.priority;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_job_priority_trigger ON public.jobs;
CREATE TRIGGER validate_job_priority_trigger
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_job_priority();