-- Create credential_sets table for storing multiple credential profiles
CREATE TABLE public.credential_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.credential_sets IS 'Stores named credential profiles for iDRAC authentication';
COMMENT ON COLUMN public.credential_sets.priority IS 'Lower priority number = tried first during discovery';
COMMENT ON COLUMN public.credential_sets.is_default IS 'Whether this is the default credential set';

-- Enable RLS
ALTER TABLE public.credential_sets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for credential_sets
CREATE POLICY "Admins can manage credential sets"
  ON public.credential_sets FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Operators can view credential sets"
  ON public.credential_sets FOR SELECT
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

-- Add trigger for updated_at
CREATE TRIGGER update_credential_sets_updated_at
  BEFORE UPDATE ON public.credential_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add credential_set_ids to jobs table
ALTER TABLE public.jobs 
ADD COLUMN credential_set_ids UUID[];

COMMENT ON COLUMN public.jobs.credential_set_ids IS 'Array of credential set IDs to try during discovery scans';

-- Add discovery tracking columns to servers table
ALTER TABLE public.servers
ADD COLUMN discovered_by_credential_set_id UUID REFERENCES public.credential_sets(id) ON DELETE SET NULL,
ADD COLUMN discovery_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.servers.discovered_by_credential_set_id IS 'Which credential set successfully discovered this server';
COMMENT ON COLUMN public.servers.discovery_job_id IS 'Which discovery job found this server';