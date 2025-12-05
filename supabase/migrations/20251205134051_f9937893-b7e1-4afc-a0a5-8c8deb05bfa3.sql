-- Add new job types for iDRAC network management
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'idrac_network_read';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'idrac_network_write';

-- Create table for iDRAC network configurations
CREATE TABLE IF NOT EXISTS public.idrac_network_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  
  -- IPv4 Settings
  ipv4_enabled BOOLEAN,
  dhcp_enabled BOOLEAN,
  ip_address TEXT,
  gateway TEXT,
  netmask TEXT,
  dns1 TEXT,
  dns2 TEXT,
  dns_from_dhcp BOOLEAN,
  
  -- NIC Settings
  nic_selection TEXT,
  nic_speed TEXT,
  nic_duplex TEXT,
  nic_mtu INTEGER,
  vlan_enabled BOOLEAN,
  vlan_id INTEGER,
  vlan_priority INTEGER,
  
  -- NTP Settings
  ntp_enabled BOOLEAN,
  ntp_server1 TEXT,
  ntp_server2 TEXT,
  ntp_server3 TEXT,
  timezone TEXT,
  
  -- Raw attributes for any custom settings
  raw_attributes JSONB,
  
  -- Metadata
  captured_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id),
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.idrac_network_configurations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view network configs"
ON public.idrac_network_configurations
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage network configs"
ON public.idrac_network_configurations
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "System can insert network configs"
ON public.idrac_network_configurations
FOR INSERT
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_idrac_network_configs_server_id ON public.idrac_network_configurations(server_id);
CREATE INDEX idx_idrac_network_configs_captured_at ON public.idrac_network_configurations(captured_at DESC);