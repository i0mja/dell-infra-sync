-- Enable realtime for jobs and job_tasks tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.job_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.servers;

-- Add index for job polling (by status and scheduled time)
CREATE INDEX idx_jobs_status_schedule ON public.jobs(status, schedule_at) WHERE status IN ('pending', 'running');

-- Add function to get user's highest role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY 
    CASE role
      WHEN 'admin' THEN 1
      WHEN 'operator' THEN 2
      WHEN 'viewer' THEN 3
    END
  LIMIT 1;
$$;