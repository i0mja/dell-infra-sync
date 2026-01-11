-- Add diagnostic logging column to pdus table
ALTER TABLE pdus ADD COLUMN IF NOT EXISTS last_sync_diagnostics JSONB;

-- Add comment for documentation
COMMENT ON COLUMN pdus.last_sync_diagnostics IS 'Stores detailed diagnostic information from the last sync attempt including SNMP and NMC errors';