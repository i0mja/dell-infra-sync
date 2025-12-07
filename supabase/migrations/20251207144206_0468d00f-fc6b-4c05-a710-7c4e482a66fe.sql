-- Create the zfs_target_templates table
CREATE TABLE public.zfs_target_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- vCenter reference
  vcenter_id UUID REFERENCES public.vcenter_settings(id) ON DELETE CASCADE,
  template_moref TEXT NOT NULL,
  template_name TEXT NOT NULL,
  
  -- Default deployment settings
  default_datacenter TEXT,
  default_cluster TEXT,
  default_datastore TEXT,
  default_network TEXT,
  default_resource_pool TEXT,
  
  -- ZFS configuration defaults
  default_zfs_pool_name TEXT DEFAULT 'tank',
  default_zfs_disk_path TEXT DEFAULT '/dev/sdb',
  default_nfs_network TEXT DEFAULT '10.0.0.0/8',
  
  -- VM sizing defaults
  default_cpu_count INTEGER DEFAULT 2,
  default_memory_gb INTEGER DEFAULT 8,
  default_zfs_disk_gb INTEGER DEFAULT 500,
  
  -- SSH access
  default_ssh_username TEXT DEFAULT 'zfsadmin',
  ssh_key_encrypted TEXT,
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies
ALTER TABLE public.zfs_target_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ZFS templates"
  ON public.zfs_target_templates FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Operators can view ZFS templates"
  ON public.zfs_target_templates FOR SELECT
  USING (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));

-- Add job type for deployment
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'deploy_zfs_target';