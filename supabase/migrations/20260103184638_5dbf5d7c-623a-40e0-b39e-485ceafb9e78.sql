-- Create table for server NIC inventory (MAC addresses, speeds, etc.)
CREATE TABLE public.server_nics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  
  -- Identification
  fqdd TEXT NOT NULL,                       -- NIC.Integrated.1-1, NIC.Slot.3-1, etc.
  name TEXT,                                 -- User-friendly name
  description TEXT,                          -- Port description
  
  -- Physical Properties
  mac_address TEXT,                          -- Primary MAC (key for network team)
  permanent_mac_address TEXT,                -- Factory MAC
  manufacturer TEXT,                         -- Broadcom, Intel, Mellanox
  model TEXT,                                -- BCM57416, X710, etc.
  serial_number TEXT,
  part_number TEXT,
  firmware_version TEXT,
  
  -- Port Info
  port_id TEXT,                              -- Port identifier
  link_status TEXT,                          -- Up, Down, NoLink
  current_speed_mbps INTEGER,                -- 25000, 10000, 1000
  max_speed_mbps INTEGER,
  duplex TEXT,                               -- Full, Half
  auto_negotiate BOOLEAN,
  mtu INTEGER,
  
  -- Connection Info (LLDP)
  switch_connection_id TEXT,                 -- LLDP detected switch port
  switch_port_description TEXT,
  switch_name TEXT,
  
  -- Addressing
  ipv4_addresses JSONB,                      -- Array of IPv4 addresses
  ipv6_addresses JSONB,                      -- Array of IPv6 addresses
  vlan_id INTEGER,
  
  -- Health
  health TEXT,                               -- OK, Warning, Critical
  status TEXT,                               -- Enabled, Disabled
  
  -- Sync tracking
  last_sync TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(server_id, fqdd)
);

-- Enable RLS
ALTER TABLE public.server_nics ENABLE ROW LEVEL SECURITY;

-- Create policies - all authenticated users can view
CREATE POLICY "Authenticated users can view server NICs"
  ON public.server_nics FOR SELECT
  TO authenticated
  USING (true);

-- Operators and admins can manage NICs
CREATE POLICY "Operators can manage server NICs"
  ON public.server_nics FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'operator')
    )
  );

-- Create indexes for common queries
CREATE INDEX idx_server_nics_server_id ON public.server_nics(server_id);
CREATE INDEX idx_server_nics_mac_address ON public.server_nics(mac_address);
CREATE INDEX idx_server_nics_fqdd ON public.server_nics(fqdd);

-- Create trigger for updated_at
CREATE TRIGGER update_server_nics_updated_at
  BEFORE UPDATE ON public.server_nics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add comment
COMMENT ON TABLE public.server_nics IS 'Stores network interface card (NIC) inventory for Dell servers including MAC addresses, speeds, and link status';