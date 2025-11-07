-- Create vcenter_settings table for storing vCenter connection info
CREATE TABLE public.vcenter_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host text NOT NULL,
  username text NOT NULL,
  password text NOT NULL, -- Will be encrypted in application layer
  port integer NOT NULL DEFAULT 443,
  verify_ssl boolean NOT NULL DEFAULT true,
  sync_enabled boolean NOT NULL DEFAULT false,
  last_sync timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vcenter_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can manage vCenter settings
CREATE POLICY "Admins can manage vcenter settings"
ON public.vcenter_settings
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add trigger for updated_at
CREATE TRIGGER update_vcenter_settings_updated_at
BEFORE UPDATE ON public.vcenter_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();