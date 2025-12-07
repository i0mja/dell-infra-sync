-- Create vcenter_networks table to store port groups and networks from vCenter
CREATE TABLE public.vcenter_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_vcenter_id UUID REFERENCES public.vcenters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vcenter_id TEXT,                    -- MoRef ID (e.g., dvportgroup-123, network-456)
  network_type TEXT,                  -- 'distributed', 'standard', 'opaque'
  vlan_id INTEGER,                    -- VLAN ID if access port
  vlan_type TEXT,                     -- 'access', 'trunk', 'pvlan', 'unknown'
  vlan_range TEXT,                    -- For trunk ports (e.g., "100-200")
  parent_switch_name TEXT,            -- DVS or vSwitch name
  parent_switch_id TEXT,              -- DVS MoRef
  accessible BOOLEAN DEFAULT true,
  host_count INTEGER DEFAULT 0,       -- How many hosts can access this network
  vm_count INTEGER DEFAULT 0,         -- VMs using this network
  uplink_port_group BOOLEAN DEFAULT false,  -- Is this an uplink port group
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_vcenter_id, vcenter_id)
);

-- Create index for faster lookups
CREATE INDEX idx_vcenter_networks_source_vcenter ON public.vcenter_networks(source_vcenter_id);
CREATE INDEX idx_vcenter_networks_name ON public.vcenter_networks(name);

-- Enable RLS
ALTER TABLE public.vcenter_networks ENABLE ROW LEVEL SECURITY;

-- RLS policies (same pattern as vcenter_datastores)
CREATE POLICY "Admins and operators can manage vcenter networks"
  ON public.vcenter_networks
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "Authenticated users can view vcenter networks"
  ON public.vcenter_networks
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_vcenter_networks_updated_at
  BEFORE UPDATE ON public.vcenter_networks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for networks table
ALTER PUBLICATION supabase_realtime ADD TABLE public.vcenter_networks;