-- Create virtual_media_settings table for NFS/CIFS/HTTP defaults
CREATE TABLE IF NOT EXISTS public.virtual_media_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_type text NOT NULL DEFAULT 'nfs',
  host text NOT NULL,
  export_path text DEFAULT '',
  iso_path text DEFAULT '',
  use_auth boolean NOT NULL DEFAULT false,
  username text,
  password text,
  allow_http_fallback boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT virtual_media_share_type_check CHECK (share_type IN ('nfs', 'cifs', 'http', 'https'))
);

-- Enable RLS
ALTER TABLE public.virtual_media_settings ENABLE ROW LEVEL SECURITY;

-- Admins can manage settings
CREATE POLICY "Admins can manage virtual media settings"
  ON public.virtual_media_settings
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Operators can view settings
CREATE POLICY "Operators can view virtual media settings"
  ON public.virtual_media_settings
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_virtual_media_settings_updated_at
  BEFORE UPDATE ON public.virtual_media_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
