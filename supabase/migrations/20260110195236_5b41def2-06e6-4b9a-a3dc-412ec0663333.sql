-- Create PDUs table for device registry
CREATE TABLE public.pdus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ip_address TEXT NOT NULL UNIQUE,
  hostname TEXT,
  model TEXT,
  manufacturer TEXT DEFAULT 'Schneider Electric',
  firmware_version TEXT,
  total_outlets INTEGER DEFAULT 8,
  username TEXT DEFAULT 'apc',
  password_encrypted TEXT,
  protocol TEXT DEFAULT 'nmc' CHECK (protocol IN ('nmc', 'snmp')),
  snmp_community TEXT DEFAULT 'public',
  connection_status TEXT DEFAULT 'unknown' CHECK (connection_status IN ('online', 'offline', 'unknown', 'error')),
  last_seen TIMESTAMPTZ,
  last_sync TIMESTAMPTZ,
  datacenter TEXT,
  rack_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create PDU outlets table
CREATE TABLE public.pdu_outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdu_id UUID NOT NULL REFERENCES public.pdus(id) ON DELETE CASCADE,
  outlet_number INTEGER NOT NULL,
  outlet_name TEXT,
  outlet_state TEXT DEFAULT 'unknown' CHECK (outlet_state IN ('on', 'off', 'unknown')),
  last_state_change TIMESTAMPTZ,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pdu_id, outlet_number)
);

-- Create server to PDU outlet mappings (supports dual-feed A/B)
CREATE TABLE public.server_pdu_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  pdu_id UUID NOT NULL REFERENCES public.pdus(id) ON DELETE CASCADE,
  outlet_number INTEGER NOT NULL,
  feed_label TEXT DEFAULT 'A' CHECK (feed_label IN ('A', 'B')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, pdu_id, outlet_number)
);

-- Enable RLS on all tables
ALTER TABLE public.pdus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdu_outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_pdu_mappings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for pdus
CREATE POLICY "Allow read access to pdus" ON public.pdus FOR SELECT USING (true);
CREATE POLICY "Allow insert access to pdus" ON public.pdus FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update access to pdus" ON public.pdus FOR UPDATE USING (true);
CREATE POLICY "Allow delete access to pdus" ON public.pdus FOR DELETE USING (true);

-- Create RLS policies for pdu_outlets
CREATE POLICY "Allow read access to pdu_outlets" ON public.pdu_outlets FOR SELECT USING (true);
CREATE POLICY "Allow insert access to pdu_outlets" ON public.pdu_outlets FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update access to pdu_outlets" ON public.pdu_outlets FOR UPDATE USING (true);
CREATE POLICY "Allow delete access to pdu_outlets" ON public.pdu_outlets FOR DELETE USING (true);

-- Create RLS policies for server_pdu_mappings
CREATE POLICY "Allow read access to server_pdu_mappings" ON public.server_pdu_mappings FOR SELECT USING (true);
CREATE POLICY "Allow insert access to server_pdu_mappings" ON public.server_pdu_mappings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update access to server_pdu_mappings" ON public.server_pdu_mappings FOR UPDATE USING (true);
CREATE POLICY "Allow delete access to server_pdu_mappings" ON public.server_pdu_mappings FOR DELETE USING (true);

-- Create indexes for performance
CREATE INDEX idx_pdus_ip_address ON public.pdus(ip_address);
CREATE INDEX idx_pdus_connection_status ON public.pdus(connection_status);
CREATE INDEX idx_pdu_outlets_pdu_id ON public.pdu_outlets(pdu_id);
CREATE INDEX idx_pdu_outlets_state ON public.pdu_outlets(outlet_state);
CREATE INDEX idx_server_pdu_mappings_server_id ON public.server_pdu_mappings(server_id);
CREATE INDEX idx_server_pdu_mappings_pdu_id ON public.server_pdu_mappings(pdu_id);

-- Create trigger for updated_at on pdus
CREATE TRIGGER update_pdus_updated_at
  BEFORE UPDATE ON public.pdus
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add pdu job types to the job_type enum
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'pdu_test_connection';
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'pdu_outlet_control';
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'pdu_sync_status';
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'pdu_discover';