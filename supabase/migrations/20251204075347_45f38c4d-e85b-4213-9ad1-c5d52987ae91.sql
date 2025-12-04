-- First, drop the existing check constraint
ALTER TABLE maintenance_windows DROP CONSTRAINT IF EXISTS valid_status;

-- Add updated check constraint that includes all valid statuses
ALTER TABLE maintenance_windows ADD CONSTRAINT valid_status 
  CHECK (status IN ('planned', 'scheduled', 'in_progress', 'completed', 'failed', 'cancelled', 'skipped'));

-- Now sync existing maintenance windows with their linked job statuses
UPDATE maintenance_windows mw
SET 
  status = CASE 
    WHEN j.status = 'failed' THEN 'failed'
    WHEN j.status = 'cancelled' THEN 'cancelled'  
    WHEN j.status = 'completed' THEN 'completed'
    WHEN j.status = 'running' THEN 'in_progress'
    ELSE mw.status
  END,
  completed_at = CASE 
    WHEN j.status IN ('failed', 'completed', 'cancelled') THEN COALESCE(j.completed_at, NOW())
    ELSE mw.completed_at
  END,
  started_at = CASE 
    WHEN j.status = 'running' AND mw.started_at IS NULL THEN COALESCE(j.started_at, NOW())
    ELSE mw.started_at
  END,
  updated_at = NOW()
FROM jobs j
WHERE j.id = ANY(mw.job_ids)
  AND mw.status NOT IN ('completed', 'failed', 'cancelled')
  AND j.status IN ('completed', 'failed', 'cancelled', 'running');