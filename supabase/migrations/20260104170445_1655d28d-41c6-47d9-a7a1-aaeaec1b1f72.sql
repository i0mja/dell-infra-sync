-- Add drive_identifier column for composite unique key
ALTER TABLE server_drives 
  ADD COLUMN IF NOT EXISTS drive_identifier TEXT;

-- Backfill existing records with serial_number based identifier
UPDATE server_drives 
SET drive_identifier = 'sn:' || serial_number 
WHERE drive_identifier IS NULL AND serial_number IS NOT NULL;

-- Backfill remaining records using location-based identifier
UPDATE server_drives 
SET drive_identifier = 'loc:' || COALESCE(controller, 'unknown') || ':' || COALESCE(slot, 'unknown') || ':' || COALESCE(name, 'drive')
WHERE drive_identifier IS NULL;

-- Drop the existing unique constraint that requires serial_number
ALTER TABLE server_drives 
  DROP CONSTRAINT IF EXISTS server_drives_server_id_serial_number_key;

-- Make drive_identifier NOT NULL after backfill
ALTER TABLE server_drives 
  ALTER COLUMN drive_identifier SET NOT NULL;

-- Create unique constraint on (server_id, drive_identifier)
ALTER TABLE server_drives 
  ADD CONSTRAINT server_drives_server_id_drive_identifier_key 
  UNIQUE (server_id, drive_identifier);

-- Create index for lookup
CREATE INDEX IF NOT EXISTS idx_server_drives_identifier 
  ON server_drives(drive_identifier);