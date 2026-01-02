-- Add next_sync_at column for precomputed scheduling
ALTER TABLE vcenters 
ADD COLUMN IF NOT EXISTS next_sync_at timestamp with time zone;

-- Compute initial values: last_sync + interval, or now() if never synced
UPDATE vcenters 
SET next_sync_at = CASE 
  WHEN last_sync IS NOT NULL THEN last_sync + (sync_interval_minutes || ' minutes')::interval
  ELSE now()
END
WHERE sync_enabled = true;

-- Create index for efficient cron queries
CREATE INDEX IF NOT EXISTS idx_vcenters_next_sync 
ON vcenters(next_sync_at) 
WHERE sync_enabled = true AND next_sync_at IS NOT NULL;

-- Trigger to auto-update next_sync_at when last_sync or settings change
CREATE OR REPLACE FUNCTION update_vcenter_next_sync()
RETURNS trigger AS $$
BEGIN
  IF NEW.sync_enabled = true THEN
    NEW.next_sync_at := COALESCE(NEW.last_sync, now()) + (NEW.sync_interval_minutes || ' minutes')::interval;
  ELSE
    NEW.next_sync_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_vcenter_next_sync ON vcenters;
CREATE TRIGGER trigger_update_vcenter_next_sync
  BEFORE UPDATE OF last_sync, sync_interval_minutes, sync_enabled ON vcenters
  FOR EACH ROW
  EXECUTE FUNCTION update_vcenter_next_sync();

-- Also handle INSERT to set initial next_sync_at
CREATE OR REPLACE FUNCTION set_vcenter_initial_next_sync()
RETURNS trigger AS $$
BEGIN
  IF NEW.sync_enabled = true AND NEW.next_sync_at IS NULL THEN
    NEW.next_sync_at := COALESCE(NEW.last_sync, now()) + (NEW.sync_interval_minutes || ' minutes')::interval;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_vcenter_initial_next_sync ON vcenters;
CREATE TRIGGER trigger_set_vcenter_initial_next_sync
  BEFORE INSERT ON vcenters
  FOR EACH ROW
  EXECUTE FUNCTION set_vcenter_initial_next_sync();