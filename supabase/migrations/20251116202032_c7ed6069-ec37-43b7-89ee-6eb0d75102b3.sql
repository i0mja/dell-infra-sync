-- Add new job types for advanced Redfish features
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'virtual_media_mount';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'virtual_media_unmount';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'bios_config_read';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'bios_config_write';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'scp_export';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'scp_import';

-- Create virtual_media_sessions table
CREATE TABLE IF NOT EXISTS public.virtual_media_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  mount_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  unmount_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  
  -- Media details
  media_type TEXT NOT NULL,
  image_name TEXT NOT NULL,
  remote_image_url TEXT NOT NULL,
  
  -- Mount status
  is_mounted BOOLEAN DEFAULT false,
  inserted BOOLEAN DEFAULT false,
  write_protected BOOLEAN DEFAULT true,
  
  -- Timestamps
  mounted_at TIMESTAMPTZ,
  unmounted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Optional auth for remote shares
  share_username TEXT,
  share_password_encrypted TEXT,
  
  CONSTRAINT valid_media_type CHECK (media_type IN ('CD', 'DVD', 'USBStick', 'Floppy'))
);

CREATE INDEX IF NOT EXISTS idx_virtual_media_server ON virtual_media_sessions(server_id);
CREATE INDEX IF NOT EXISTS idx_virtual_media_mounted ON virtual_media_sessions(is_mounted);

-- Create bios_configurations table
CREATE TABLE IF NOT EXISTS public.bios_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  
  -- Configuration snapshot
  attributes JSONB NOT NULL,
  pending_attributes JSONB,
  
  -- Metadata
  bios_version TEXT,
  snapshot_type TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id),
  notes TEXT,
  
  -- Timestamps
  captured_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT valid_snapshot_type CHECK (snapshot_type IN ('current', 'pending', 'baseline'))
);

CREATE INDEX IF NOT EXISTS idx_bios_config_server ON bios_configurations(server_id);
CREATE INDEX IF NOT EXISTS idx_bios_config_type ON bios_configurations(snapshot_type);
CREATE INDEX IF NOT EXISTS idx_bios_config_created ON bios_configurations(created_at DESC);

-- Create scp_backups table
CREATE TABLE IF NOT EXISTS public.scp_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  export_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  import_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  
  -- Backup metadata
  backup_name TEXT NOT NULL,
  description TEXT,
  
  -- SCP file details
  scp_file_path TEXT,
  scp_file_size_bytes BIGINT,
  scp_content JSONB,
  
  -- Configuration scope
  include_bios BOOLEAN DEFAULT true,
  include_idrac BOOLEAN DEFAULT true,
  include_nic BOOLEAN DEFAULT true,
  include_raid BOOLEAN DEFAULT true,
  
  -- Validation
  checksum TEXT,
  is_valid BOOLEAN DEFAULT true,
  validation_errors TEXT,
  
  -- Timestamps
  exported_at TIMESTAMPTZ,
  last_imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_scp_backups_server ON scp_backups(server_id);
CREATE INDEX IF NOT EXISTS idx_scp_backups_created ON scp_backups(created_at DESC);

-- Enable RLS on virtual_media_sessions
ALTER TABLE public.virtual_media_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view virtual media sessions"
  ON public.virtual_media_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage virtual media"
  ON public.virtual_media_sessions FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Enable RLS on bios_configurations
ALTER TABLE public.bios_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view BIOS configs"
  ON public.bios_configurations FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage BIOS configs"
  ON public.bios_configurations FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Enable RLS on scp_backups
ALTER TABLE public.scp_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view SCP backups"
  ON public.scp_backups FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage SCP backups"
  ON public.scp_backups FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Add trigger for virtual_media_sessions updated_at
CREATE TRIGGER update_virtual_media_sessions_updated_at
  BEFORE UPDATE ON public.virtual_media_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();