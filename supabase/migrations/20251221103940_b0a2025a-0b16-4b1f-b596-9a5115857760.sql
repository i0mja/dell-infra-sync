-- Create maintenance blocker resolutions table
CREATE TABLE public.maintenance_blocker_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_window_id UUID REFERENCES public.maintenance_windows(id) ON DELETE CASCADE,
  host_id UUID NOT NULL,
  host_name TEXT NOT NULL,
  vm_id TEXT NOT NULL,
  vm_name TEXT NOT NULL,
  blocker_reason TEXT NOT NULL, -- passthrough, local_storage, vcsa, fault_tolerance, vgpu, affinity, connected_media, critical_infra
  resolution_type TEXT NOT NULL, -- power_off, skip_host, migrate_first, acknowledged
  resolution_details JSONB DEFAULT '{}',
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ DEFAULT now(),
  executed_at TIMESTAMPTZ,
  execution_result TEXT,
  powered_on_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.maintenance_blocker_resolutions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view blocker resolutions"
  ON public.maintenance_blocker_resolutions
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage blocker resolutions"
  ON public.maintenance_blocker_resolutions
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Add indexes for common queries
CREATE INDEX idx_blocker_resolutions_maintenance_window ON public.maintenance_blocker_resolutions(maintenance_window_id);
CREATE INDEX idx_blocker_resolutions_host ON public.maintenance_blocker_resolutions(host_id);

-- Add comment
COMMENT ON TABLE public.maintenance_blocker_resolutions IS 'Tracks user decisions about VMs that block maintenance mode entry';