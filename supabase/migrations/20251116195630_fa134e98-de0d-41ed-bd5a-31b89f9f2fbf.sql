-- Add boot configuration job type
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'boot_configuration';

-- Add boot configuration columns to servers table
ALTER TABLE servers 
ADD COLUMN IF NOT EXISTS boot_mode TEXT,
ADD COLUMN IF NOT EXISTS boot_source_override_enabled TEXT,
ADD COLUMN IF NOT EXISTS boot_source_override_target TEXT,
ADD COLUMN IF NOT EXISTS boot_order JSONB,
ADD COLUMN IF NOT EXISTS last_boot_config_check TIMESTAMPTZ;

-- Create server boot configuration history table
CREATE TABLE IF NOT EXISTS server_boot_config_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  boot_mode TEXT,
  boot_source_override_enabled TEXT,
  boot_source_override_target TEXT,
  boot_order JSONB,
  changed_by UUID,
  job_id UUID REFERENCES jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_boot_config_history_server_id ON server_boot_config_history(server_id);
CREATE INDEX IF NOT EXISTS idx_boot_config_history_timestamp ON server_boot_config_history(timestamp DESC);

-- Enable RLS
ALTER TABLE server_boot_config_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view boot config history"
  ON server_boot_config_history FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert boot config history"
  ON server_boot_config_history FOR INSERT
  TO authenticated
  WITH CHECK (true);