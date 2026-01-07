-- Add columns for historical drive data tracking
ALTER TABLE server_drives 
  ADD COLUMN IF NOT EXISTS last_known_serial_number TEXT,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT NOW();

-- Add index for querying failed drives efficiently
CREATE INDEX IF NOT EXISTS idx_server_drives_failed 
  ON server_drives (server_id) 
  WHERE health = 'Critical' OR status IN ('Disabled', 'UnavailableOffline') OR predicted_failure = true;

-- Backfill failed_at for existing failed drives
UPDATE server_drives 
SET failed_at = last_sync 
WHERE failed_at IS NULL 
  AND (health = 'Critical' OR status IN ('Disabled', 'UnavailableOffline'));