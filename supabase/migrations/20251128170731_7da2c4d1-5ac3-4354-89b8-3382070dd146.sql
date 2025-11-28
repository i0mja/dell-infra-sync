-- Add new job types for ESXi upgrades
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'esxi_upgrade';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'esxi_then_firmware';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'firmware_then_esxi';

-- Create ESXi upgrade profiles table
CREATE TABLE public.esxi_upgrade_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  target_version text NOT NULL,
  bundle_path text NOT NULL,
  profile_name text NOT NULL,
  datastore_name text,
  min_source_version text,
  release_date date,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Enable RLS on esxi_upgrade_profiles
ALTER TABLE public.esxi_upgrade_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for esxi_upgrade_profiles
CREATE POLICY "Authenticated users can view ESXi profiles"
  ON public.esxi_upgrade_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage ESXi profiles"
  ON public.esxi_upgrade_profiles
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role) OR 
    public.has_role(auth.uid(), 'operator'::app_role)
  );

-- Create ESXi upgrade history table
CREATE TABLE public.esxi_upgrade_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vcenter_host_id uuid REFERENCES public.vcenter_hosts(id) ON DELETE CASCADE,
  server_id uuid REFERENCES public.servers(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.esxi_upgrade_profiles(id) ON DELETE SET NULL,
  version_before text NOT NULL,
  version_after text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  status text DEFAULT 'pending',
  error_message text,
  ssh_output text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on esxi_upgrade_history
ALTER TABLE public.esxi_upgrade_history ENABLE ROW LEVEL SECURITY;

-- RLS policies for esxi_upgrade_history
CREATE POLICY "Authenticated users can view ESXi upgrade history"
  ON public.esxi_upgrade_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can insert ESXi upgrade history"
  ON public.esxi_upgrade_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role) OR 
    public.has_role(auth.uid(), 'operator'::app_role)
  );

-- Create indexes for performance
CREATE INDEX idx_esxi_profiles_active ON public.esxi_upgrade_profiles(is_active) WHERE is_active = true;
CREATE INDEX idx_esxi_history_vcenter_host ON public.esxi_upgrade_history(vcenter_host_id);
CREATE INDEX idx_esxi_history_job ON public.esxi_upgrade_history(job_id);
CREATE INDEX idx_esxi_history_status ON public.esxi_upgrade_history(status);

-- Add trigger for updated_at on esxi_upgrade_profiles
CREATE TRIGGER update_esxi_upgrade_profiles_updated_at
  BEFORE UPDATE ON public.esxi_upgrade_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();