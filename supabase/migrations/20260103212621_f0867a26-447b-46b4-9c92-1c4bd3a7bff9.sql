-- Create function to atomically append to job console_log without overwriting other details
CREATE OR REPLACE FUNCTION public.append_job_console_log(p_job_id uuid, p_log_entry text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE jobs 
  SET details = jsonb_set(
    COALESCE(details, '{}'::jsonb),
    '{console_log}',
    COALESCE(details->'console_log', '[]'::jsonb) || to_jsonb(p_log_entry)
  )
  WHERE id = p_job_id;
END;
$$;