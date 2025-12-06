-- ============================================
-- ZERFAUX DR ORCHESTRATION MODULE - DATABASE SCHEMA
-- ============================================

-- 1. REPLICATION TARGETS
-- Represents DR sites with ZFS storage endpoints
CREATE TABLE public.replication_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  target_type TEXT NOT NULL DEFAULT 'zfs', -- 'zfs', 'nfs', 'iscsi'
  hostname TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  zfs_pool TEXT NOT NULL, -- e.g., 'tank/replicated'
  zfs_dataset_prefix TEXT, -- e.g., 'dr-vms'
  ssh_username TEXT,
  ssh_key_encrypted TEXT,
  dr_vcenter_id UUID REFERENCES public.vcenter_settings(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  last_health_check TIMESTAMP WITH TIME ZONE,
  health_status TEXT DEFAULT 'unknown', -- 'healthy', 'degraded', 'offline', 'unknown'
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. PROTECTION GROUPS
-- Logical grouping of VMs that replicate together
CREATE TABLE public.protection_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source_vcenter_id UUID REFERENCES public.vcenter_settings(id) ON DELETE SET NULL,
  target_id UUID REFERENCES public.replication_targets(id) ON DELETE SET NULL,
  protection_datastore TEXT, -- Required datastore for protected VMs
  replication_schedule TEXT, -- Cron expression or interval
  retention_policy JSONB DEFAULT '{"daily": 7, "weekly": 4, "monthly": 12}'::jsonb,
  rpo_minutes INTEGER DEFAULT 60, -- Recovery Point Objective
  is_enabled BOOLEAN DEFAULT true,
  last_replication_at TIMESTAMP WITH TIME ZONE,
  next_replication_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. PROTECTED VMS
-- VMs assigned to protection groups for replication
CREATE TABLE public.protected_vms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  protection_group_id UUID NOT NULL REFERENCES public.protection_groups(id) ON DELETE CASCADE,
  vm_id UUID REFERENCES public.vcenter_vms(id) ON DELETE SET NULL,
  vm_name TEXT NOT NULL,
  vm_vcenter_id TEXT, -- VMware MoRef ID
  current_datastore TEXT,
  target_datastore TEXT, -- Where it should be for protection
  needs_storage_vmotion BOOLEAN DEFAULT false,
  dr_shell_vm_name TEXT, -- Name of shell VM at DR site
  dr_shell_vm_created BOOLEAN DEFAULT false,
  dr_shell_vm_id TEXT, -- VMware MoRef of shell VM at DR
  last_snapshot_at TIMESTAMP WITH TIME ZONE,
  last_replication_at TIMESTAMP WITH TIME ZONE,
  replication_status TEXT DEFAULT 'pending', -- 'pending', 'active', 'paused', 'error'
  status_message TEXT,
  priority INTEGER DEFAULT 100, -- Lower = higher priority
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. REPLICATION JOBS
-- Track individual replication job executions
CREATE TABLE public.replication_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  protection_group_id UUID REFERENCES public.protection_groups(id) ON DELETE SET NULL,
  protected_vm_id UUID REFERENCES public.protected_vms(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL, -- 'scheduled', 'manual', 'initial_sync', 'failover_test'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'cancelled'
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  bytes_transferred BIGINT DEFAULT 0,
  snapshot_name TEXT,
  source_snapshot TEXT, -- ZFS snapshot name at source
  target_snapshot TEXT, -- ZFS snapshot name at target
  incremental BOOLEAN DEFAULT false,
  error_message TEXT,
  log TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_protected_vms_group ON public.protected_vms(protection_group_id);
CREATE INDEX idx_protected_vms_status ON public.protected_vms(replication_status);
CREATE INDEX idx_replication_jobs_group ON public.replication_jobs(protection_group_id);
CREATE INDEX idx_replication_jobs_status ON public.replication_jobs(status);
CREATE INDEX idx_replication_jobs_created ON public.replication_jobs(created_at DESC);
CREATE INDEX idx_protection_groups_vcenter ON public.protection_groups(source_vcenter_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.replication_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protection_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protected_vms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replication_jobs ENABLE ROW LEVEL SECURITY;

-- REPLICATION TARGETS policies
CREATE POLICY "Authenticated users can view replication targets"
  ON public.replication_targets FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage replication targets"
  ON public.replication_targets FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- PROTECTION GROUPS policies
CREATE POLICY "Authenticated users can view protection groups"
  ON public.protection_groups FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage protection groups"
  ON public.protection_groups FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- PROTECTED VMS policies
CREATE POLICY "Authenticated users can view protected VMs"
  ON public.protected_vms FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage protected VMs"
  ON public.protected_vms FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- REPLICATION JOBS policies
CREATE POLICY "Authenticated users can view replication jobs"
  ON public.replication_jobs FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage replication jobs"
  ON public.replication_jobs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================
CREATE TRIGGER update_replication_targets_updated_at
  BEFORE UPDATE ON public.replication_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_protection_groups_updated_at
  BEFORE UPDATE ON public.protection_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_protected_vms_updated_at
  BEFORE UPDATE ON public.protected_vms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_replication_jobs_updated_at
  BEFORE UPDATE ON public.replication_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();