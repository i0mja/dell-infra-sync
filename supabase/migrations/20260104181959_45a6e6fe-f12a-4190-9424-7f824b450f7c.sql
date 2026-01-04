-- Add missing columns to server_drives for RAID/Volume info
ALTER TABLE server_drives 
ADD COLUMN IF NOT EXISTS volume_id text,
ADD COLUMN IF NOT EXISTS volume_name text,
ADD COLUMN IF NOT EXISTS raid_level text,
ADD COLUMN IF NOT EXISTS wwn text,
ADD COLUMN IF NOT EXISTS naa text,
ADD COLUMN IF NOT EXISTS span_depth integer,
ADD COLUMN IF NOT EXISTS span_length integer;

-- Add comments for documentation
COMMENT ON COLUMN server_drives.volume_id IS 'Redfish volume ID';
COMMENT ON COLUMN server_drives.volume_name IS 'Volume display name';
COMMENT ON COLUMN server_drives.raid_level IS 'RAID level (RAID0, RAID1, etc)';
COMMENT ON COLUMN server_drives.wwn IS 'World Wide Name for ESXi datastore correlation';
COMMENT ON COLUMN server_drives.naa IS 'NAA identifier for ESXi datastore correlation';
COMMENT ON COLUMN server_drives.span_depth IS 'RAID span depth';
COMMENT ON COLUMN server_drives.span_length IS 'RAID span length';