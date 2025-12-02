-- Fix security warning: Set search_path for validate_job_priority function
CREATE OR REPLACE FUNCTION public.validate_job_priority()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.priority IS NOT NULL AND NEW.priority NOT IN ('low', 'normal', 'high', 'critical') THEN
    RAISE EXCEPTION 'Invalid priority value: %. Must be one of: low, normal, high, critical', NEW.priority;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;