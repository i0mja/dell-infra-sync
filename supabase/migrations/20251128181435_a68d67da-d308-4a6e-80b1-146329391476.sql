-- Add 'paused' status to maintenance_windows
ALTER TABLE maintenance_windows 
DROP CONSTRAINT IF EXISTS maintenance_windows_status_check;

ALTER TABLE maintenance_windows 
ADD CONSTRAINT maintenance_windows_status_check 
CHECK (status IN ('planned', 'in_progress', 'completed', 'failed', 'cancelled', 'paused'));

-- Add skip_count column to track skipped runs
ALTER TABLE maintenance_windows 
ADD COLUMN IF NOT EXISTS skip_count integer DEFAULT 0;