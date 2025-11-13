-- Create credential_ip_ranges table
CREATE TABLE IF NOT EXISTS public.credential_ip_ranges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_set_id UUID REFERENCES public.credential_sets(id) ON DELETE CASCADE NOT NULL,
  ip_range TEXT NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_credential_ip_ranges_credential_set 
  ON public.credential_ip_ranges(credential_set_id);

-- Enable RLS
ALTER TABLE public.credential_ip_ranges ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage IP ranges"
  ON public.credential_ip_ranges FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Operators can view IP ranges"
  ON public.credential_ip_ranges FOR SELECT
  USING (public.has_role(auth.uid(), 'operator'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_credential_ip_ranges_updated_at
  BEFORE UPDATE ON public.credential_ip_ranges
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();