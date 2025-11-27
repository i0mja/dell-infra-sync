-- Add enhanced hardware columns to servers table
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS cpu_model TEXT;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS cpu_cores_per_socket INTEGER;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS cpu_speed TEXT;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS secure_boot TEXT;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS virtualization_enabled BOOLEAN;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS total_drives INTEGER;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS total_storage_tb NUMERIC;

-- Create server_drives table for detailed drive inventory
CREATE TABLE IF NOT EXISTS public.server_drives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  
  -- Drive identification
  name TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  part_number TEXT,
  
  -- Drive specs
  media_type TEXT,
  protocol TEXT,
  capacity_bytes BIGINT,
  capacity_gb NUMERIC,
  
  -- Physical location
  slot TEXT,
  enclosure TEXT,
  controller TEXT,
  
  -- Status
  health TEXT,
  status TEXT,
  predicted_failure BOOLEAN DEFAULT false,
  life_remaining_percent INTEGER,
  
  -- Metadata
  firmware_version TEXT,
  rotation_speed_rpm INTEGER,
  capable_speed_gbps NUMERIC,
  
  last_sync TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(server_id, serial_number)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_server_drives_server_id ON public.server_drives(server_id);
CREATE INDEX IF NOT EXISTS idx_server_drives_media_type ON public.server_drives(media_type);

-- Enable RLS on server_drives
ALTER TABLE public.server_drives ENABLE ROW LEVEL SECURITY;

-- RLS policies for server_drives
CREATE POLICY "Authenticated users can view server drives"
  ON public.server_drives
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage server drives"
  ON public.server_drives
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'operator')
    )
  );