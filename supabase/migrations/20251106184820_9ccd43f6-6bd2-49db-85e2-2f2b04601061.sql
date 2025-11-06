-- Add connection status tracking columns to servers table
ALTER TABLE servers 
ADD COLUMN last_connection_test TIMESTAMPTZ,
ADD COLUMN connection_status TEXT CHECK (connection_status IN ('online', 'offline', 'unknown')),
ADD COLUMN connection_error TEXT;

-- Set default status for existing servers
UPDATE servers SET connection_status = 'unknown' WHERE connection_status IS NULL;