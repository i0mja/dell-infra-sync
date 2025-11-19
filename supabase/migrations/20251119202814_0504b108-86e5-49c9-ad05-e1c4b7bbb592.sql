-- Add auto_execute flag and job configuration fields to maintenance_windows
ALTER TABLE maintenance_windows 
ADD COLUMN IF NOT EXISTS auto_execute BOOLEAN DEFAULT true;

-- Add details JSONB for job-specific config (firmware URIs, etc.)
ALTER TABLE maintenance_windows 
ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;

-- Add credential_set_ids array for job creation
ALTER TABLE maintenance_windows 
ADD COLUMN IF NOT EXISTS credential_set_ids UUID[] DEFAULT '{}';

-- Add index for scheduler query performance
CREATE INDEX IF NOT EXISTS idx_maintenance_windows_scheduler 
ON maintenance_windows(status, planned_start, planned_end) 
WHERE status = 'planned' AND auto_execute = true;

-- Add comment for documentation
COMMENT ON COLUMN maintenance_windows.auto_execute IS 'Whether to automatically create and execute jobs at planned_start time';
COMMENT ON COLUMN maintenance_windows.details IS 'Job-specific configuration like firmware_uri, component, cluster settings, etc.';
COMMENT ON COLUMN maintenance_windows.credential_set_ids IS 'Credential sets to use for job execution';