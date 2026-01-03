-- Create global iDRAC settings table
CREATE TABLE public.idrac_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What to fetch during sync
  fetch_firmware boolean NOT NULL DEFAULT true,
  fetch_health boolean NOT NULL DEFAULT true,
  fetch_bios boolean NOT NULL DEFAULT true,
  fetch_storage boolean NOT NULL DEFAULT true,
  fetch_nics boolean NOT NULL DEFAULT true,
  fetch_scp_backup boolean NOT NULL DEFAULT false,
  
  -- Auto-sync schedule
  auto_sync_enabled boolean NOT NULL DEFAULT false,
  sync_interval_minutes integer NOT NULL DEFAULT 60,
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert default settings row
INSERT INTO public.idrac_settings DEFAULT VALUES;

-- Enable RLS
ALTER TABLE public.idrac_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can manage iDRAC settings"
  ON public.idrac_settings
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view iDRAC settings"
  ON public.idrac_settings
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Add per-server override columns to servers table
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS idrac_sync_enabled boolean,
  ADD COLUMN IF NOT EXISTS idrac_sync_interval_minutes integer,
  ADD COLUMN IF NOT EXISTS idrac_fetch_options jsonb,
  ADD COLUMN IF NOT EXISTS last_idrac_sync timestamptz,
  ADD COLUMN IF NOT EXISTS next_idrac_sync_at timestamptz;

-- Create trigger for updated_at
CREATE TRIGGER update_idrac_settings_updated_at
  BEFORE UPDATE ON public.idrac_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();