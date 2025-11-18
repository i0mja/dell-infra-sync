-- Phase 5: Cluster Safety Checks Table
CREATE TABLE IF NOT EXISTS public.cluster_safety_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL,
  check_timestamp TIMESTAMPTZ DEFAULT now(),
  total_hosts INTEGER NOT NULL,
  healthy_hosts INTEGER NOT NULL,
  min_required_hosts INTEGER NOT NULL,
  safe_to_proceed BOOLEAN NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cluster_safety_checks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view cluster safety checks"
  ON public.cluster_safety_checks
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can insert cluster safety checks"
  ON public.cluster_safety_checks
  FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_cluster_safety_checks_job_id 
  ON public.cluster_safety_checks(job_id);
CREATE INDEX IF NOT EXISTS idx_cluster_safety_checks_cluster_id 
  ON public.cluster_safety_checks(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_safety_checks_timestamp 
  ON public.cluster_safety_checks(check_timestamp DESC);