-- Create vcenters table to support multiple vCenter connections
CREATE TABLE public.vcenters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  datacenter_location text,
  host text NOT NULL,
  username text NOT NULL,
  password_encrypted text,
  port integer NOT NULL DEFAULT 443,
  verify_ssl boolean NOT NULL DEFAULT false,
  sync_enabled boolean NOT NULL DEFAULT true,
  sync_interval_minutes integer DEFAULT 60,
  last_sync timestamp with time zone,
  last_sync_status text,
  last_sync_error text,
  is_primary boolean DEFAULT false,
  color text DEFAULT '#6366f1',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add source_vcenter_id to all vCenter data tables
ALTER TABLE public.vcenter_hosts ADD COLUMN source_vcenter_id uuid REFERENCES public.vcenters(id) ON DELETE CASCADE;
ALTER TABLE public.vcenter_vms ADD COLUMN source_vcenter_id uuid REFERENCES public.vcenters(id) ON DELETE CASCADE;
ALTER TABLE public.vcenter_clusters ADD COLUMN source_vcenter_id uuid REFERENCES public.vcenters(id) ON DELETE CASCADE;
ALTER TABLE public.vcenter_datastores ADD COLUMN source_vcenter_id uuid REFERENCES public.vcenters(id) ON DELETE CASCADE;
ALTER TABLE public.vcenter_alarms ADD COLUMN source_vcenter_id uuid REFERENCES public.vcenters(id) ON DELETE CASCADE;

-- Create indexes for efficient filtering by source vCenter
CREATE INDEX idx_vcenter_hosts_source ON public.vcenter_hosts(source_vcenter_id);
CREATE INDEX idx_vcenter_vms_source ON public.vcenter_vms(source_vcenter_id);
CREATE INDEX idx_vcenter_clusters_source ON public.vcenter_clusters(source_vcenter_id);
CREATE INDEX idx_vcenter_datastores_source ON public.vcenter_datastores(source_vcenter_id);
CREATE INDEX idx_vcenter_alarms_source ON public.vcenter_alarms(source_vcenter_id);

-- Migrate existing vcenter_settings data to vcenters table
INSERT INTO public.vcenters (name, host, username, password_encrypted, port, verify_ssl, sync_enabled, last_sync, is_primary, color)
SELECT 
  COALESCE(host, 'Primary vCenter') as name,
  host,
  username,
  password,
  port,
  verify_ssl,
  sync_enabled,
  last_sync,
  true as is_primary,
  '#6366f1' as color
FROM public.vcenter_settings
WHERE host IS NOT NULL
LIMIT 1;

-- Enable RLS on vcenters table
ALTER TABLE public.vcenters ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vcenters table
CREATE POLICY "Admins can manage vcenters"
ON public.vcenters
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view vcenters"
ON public.vcenters
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Add trigger for updated_at
CREATE TRIGGER update_vcenters_updated_at
BEFORE UPDATE ON public.vcenters
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();