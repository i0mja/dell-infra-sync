-- Create openmanage_settings table
CREATE TABLE public.openmanage_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host text NOT NULL,
  port integer NOT NULL DEFAULT 443,
  username text NOT NULL,
  password text NOT NULL,
  verify_ssl boolean NOT NULL DEFAULT true,
  sync_enabled boolean NOT NULL DEFAULT false,
  last_sync timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.openmanage_settings ENABLE ROW LEVEL SECURITY;

-- Admin-only access policies
CREATE POLICY "Admins can manage openmanage settings"
  ON public.openmanage_settings
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_openmanage_settings_updated_at
  BEFORE UPDATE ON public.openmanage_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add columns to servers table for OpenManage tracking
ALTER TABLE public.servers
ADD COLUMN IF NOT EXISTS openmanage_device_id text,
ADD COLUMN IF NOT EXISTS last_openmanage_sync timestamp with time zone;