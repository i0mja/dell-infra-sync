-- Create server_memory table for storing per-DIMM memory module information
CREATE TABLE IF NOT EXISTS public.server_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  dimm_identifier TEXT NOT NULL,           -- e.g., "DIMM.Socket.B2"
  slot_name TEXT,                           -- e.g., "B2"
  manufacturer TEXT,
  part_number TEXT,
  serial_number TEXT,
  capacity_mb INTEGER,
  speed_mhz INTEGER,
  memory_type TEXT,                         -- e.g., "DDR4"
  rank_count INTEGER,
  health TEXT,                              -- "OK", "Warning", "Critical"
  status TEXT,                              -- "Enabled", "Disabled", "Absent"
  operating_speed_mhz INTEGER,
  error_correction TEXT,
  volatile_size_mb INTEGER,
  non_volatile_size_mb INTEGER,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_server_dimm UNIQUE (server_id, dimm_identifier)
);

-- Index for fast lookups
CREATE INDEX idx_server_memory_server_id ON public.server_memory(server_id);
CREATE INDEX idx_server_memory_health ON public.server_memory(health);

-- Enable RLS
ALTER TABLE public.server_memory ENABLE ROW LEVEL SECURITY;

-- RLS policy (same as server_drives - allow authenticated users)
CREATE POLICY "Allow all operations for authenticated users" 
  ON public.server_memory 
  FOR ALL 
  TO authenticated 
  USING (true);

-- Enable realtime for memory status updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.server_memory;