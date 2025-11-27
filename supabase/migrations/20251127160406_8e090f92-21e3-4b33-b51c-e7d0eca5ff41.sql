-- Create vcenter_clusters table for cluster statistics
CREATE TABLE public.vcenter_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_name TEXT NOT NULL UNIQUE,
  vcenter_id TEXT,
  total_cpu_mhz BIGINT,
  used_cpu_mhz BIGINT,
  total_memory_bytes BIGINT,
  used_memory_bytes BIGINT,
  total_storage_bytes BIGINT,
  used_storage_bytes BIGINT,
  host_count INTEGER,
  vm_count INTEGER,
  ha_enabled BOOLEAN DEFAULT false,
  drs_enabled BOOLEAN DEFAULT false,
  drs_automation_level TEXT,
  overall_status TEXT,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create vcenter_vms table for VM inventory
CREATE TABLE public.vcenter_vms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  vcenter_id TEXT UNIQUE,
  host_id UUID REFERENCES public.vcenter_hosts(id) ON DELETE SET NULL,
  cluster_name TEXT,
  power_state TEXT,
  guest_os TEXT,
  cpu_count INTEGER,
  memory_mb INTEGER,
  disk_gb NUMERIC,
  ip_address TEXT,
  tools_status TEXT,
  tools_version TEXT,
  overall_status TEXT,
  notes TEXT,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create vcenter_alarms table for active alarms
CREATE TABLE public.vcenter_alarms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alarm_key TEXT NOT NULL UNIQUE,
  entity_type TEXT,
  entity_name TEXT,
  entity_id TEXT,
  alarm_name TEXT,
  alarm_status TEXT,
  acknowledged BOOLEAN DEFAULT false,
  triggered_at TIMESTAMPTZ,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create vcenter_datastores table for storage overview
CREATE TABLE public.vcenter_datastores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  vcenter_id TEXT UNIQUE,
  type TEXT,
  capacity_bytes BIGINT,
  free_bytes BIGINT,
  accessible BOOLEAN DEFAULT true,
  maintenance_mode TEXT,
  vm_count INTEGER,
  host_count INTEGER,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.vcenter_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vcenter_vms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vcenter_alarms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vcenter_datastores ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vcenter_clusters
CREATE POLICY "Authenticated users can view vcenter clusters"
  ON public.vcenter_clusters FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage vcenter clusters"
  ON public.vcenter_clusters FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

-- RLS Policies for vcenter_vms
CREATE POLICY "Authenticated users can view vcenter VMs"
  ON public.vcenter_vms FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage vcenter VMs"
  ON public.vcenter_vms FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

-- RLS Policies for vcenter_alarms
CREATE POLICY "Authenticated users can view vcenter alarms"
  ON public.vcenter_alarms FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage vcenter alarms"
  ON public.vcenter_alarms FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

-- RLS Policies for vcenter_datastores
CREATE POLICY "Authenticated users can view vcenter datastores"
  ON public.vcenter_datastores FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage vcenter datastores"
  ON public.vcenter_datastores FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

-- Create indexes for performance
CREATE INDEX idx_vcenter_clusters_name ON public.vcenter_clusters(cluster_name);
CREATE INDEX idx_vcenter_vms_host ON public.vcenter_vms(host_id);
CREATE INDEX idx_vcenter_vms_cluster ON public.vcenter_vms(cluster_name);
CREATE INDEX idx_vcenter_vms_vcenter_id ON public.vcenter_vms(vcenter_id);
CREATE INDEX idx_vcenter_alarms_status ON public.vcenter_alarms(alarm_status);
CREATE INDEX idx_vcenter_alarms_acknowledged ON public.vcenter_alarms(acknowledged);
CREATE INDEX idx_vcenter_datastores_vcenter_id ON public.vcenter_datastores(vcenter_id);

-- Add triggers for updated_at
CREATE TRIGGER update_vcenter_clusters_updated_at
  BEFORE UPDATE ON public.vcenter_clusters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vcenter_vms_updated_at
  BEFORE UPDATE ON public.vcenter_vms
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vcenter_alarms_updated_at
  BEFORE UPDATE ON public.vcenter_alarms
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vcenter_datastores_updated_at
  BEFORE UPDATE ON public.vcenter_datastores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();