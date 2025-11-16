-- Add power and health columns to servers table
ALTER TABLE servers 
ADD COLUMN IF NOT EXISTS power_state TEXT,
ADD COLUMN IF NOT EXISTS overall_health TEXT,
ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMPTZ;

-- Create server_health table for storing health metrics
CREATE TABLE IF NOT EXISTS server_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  power_state TEXT,
  overall_health TEXT,
  temperature_celsius NUMERIC,
  fan_health TEXT,
  psu_health TEXT,
  storage_health TEXT,
  memory_health TEXT,
  network_health TEXT,
  sensors JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_server_health_server_id ON server_health(server_id);
CREATE INDEX IF NOT EXISTS idx_server_health_timestamp ON server_health(timestamp DESC);

-- Create server_event_logs table for SEL entries
CREATE TABLE IF NOT EXISTS server_event_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  event_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  severity TEXT,
  message TEXT,
  category TEXT,
  sensor_type TEXT,
  sensor_number TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_server_event_logs_server_id ON server_event_logs(server_id);
CREATE INDEX IF NOT EXISTS idx_server_event_logs_timestamp ON server_event_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_server_event_logs_severity ON server_event_logs(severity);

-- Add new job types to enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_type') THEN
    CREATE TYPE job_type AS ENUM ('firmware_update', 'discovery_scan', 'vcenter_sync', 'full_server_update', 'test_credentials');
  END IF;
  
  ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'power_action';
  ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'health_check';
  ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'fetch_event_logs';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Enable RLS on new tables
ALTER TABLE server_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_event_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for server_health
CREATE POLICY "Authenticated users can view server health"
  ON server_health FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert server health"
  ON server_health FOR INSERT
  WITH CHECK (true);

-- RLS policies for server_event_logs
CREATE POLICY "Authenticated users can view event logs"
  ON server_event_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert event logs"
  ON server_event_logs FOR INSERT
  WITH CHECK (true);