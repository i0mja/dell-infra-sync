-- Create update availability scans table
CREATE TABLE public.update_availability_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type TEXT NOT NULL CHECK (scan_type IN ('cluster', 'group', 'servers', 'single_host')),
  target_id TEXT,
  target_name TEXT,
  target_server_ids UUID[],
  firmware_source TEXT NOT NULL CHECK (firmware_source IN ('local_repository', 'dell_online_catalog')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  summary JSONB DEFAULT '{}'::jsonb,
  error_message TEXT
);

-- Create update availability results table (per-host results)
CREATE TABLE public.update_availability_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.update_availability_scans(id) ON DELETE CASCADE,
  server_id UUID REFERENCES public.servers(id) ON DELETE SET NULL,
  vcenter_host_id UUID REFERENCES public.vcenter_hosts(id) ON DELETE SET NULL,
  hostname TEXT,
  server_model TEXT,
  service_tag TEXT,
  esxi_version TEXT,
  esxi_update_available BOOLEAN DEFAULT false,
  esxi_target_version TEXT,
  firmware_components JSONB DEFAULT '[]'::jsonb,
  total_components INTEGER DEFAULT 0,
  updates_available INTEGER DEFAULT 0,
  critical_updates INTEGER DEFAULT 0,
  up_to_date INTEGER DEFAULT 0,
  not_in_catalog INTEGER DEFAULT 0,
  blockers JSONB DEFAULT '[]'::jsonb,
  scan_status TEXT DEFAULT 'pending' CHECK (scan_status IN ('pending', 'scanning', 'completed', 'failed', 'skipped')),
  scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for fast lookups
CREATE INDEX idx_update_scans_target ON public.update_availability_scans(scan_type, target_id);
CREATE INDEX idx_update_scans_status ON public.update_availability_scans(status);
CREATE INDEX idx_update_scans_created ON public.update_availability_scans(created_at DESC);
CREATE INDEX idx_update_results_scan ON public.update_availability_results(scan_id);
CREATE INDEX idx_update_results_server ON public.update_availability_results(server_id);
CREATE INDEX idx_update_results_host ON public.update_availability_results(vcenter_host_id);

-- Enable RLS
ALTER TABLE public.update_availability_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.update_availability_results ENABLE ROW LEVEL SECURITY;

-- RLS policies for update_availability_scans
CREATE POLICY "Authenticated users can view update scans"
  ON public.update_availability_scans
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage update scans"
  ON public.update_availability_scans
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- RLS policies for update_availability_results
CREATE POLICY "Authenticated users can view update results"
  ON public.update_availability_results
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage update results"
  ON public.update_availability_results
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));