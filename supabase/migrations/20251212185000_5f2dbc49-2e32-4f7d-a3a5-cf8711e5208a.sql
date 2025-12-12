-- Add archived_at column to replication_targets for soft delete
ALTER TABLE public.replication_targets 
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for filtering active (non-archived) targets
CREATE INDEX IF NOT EXISTS idx_replication_targets_archived 
ON public.replication_targets(archived_at) WHERE archived_at IS NULL;

-- Add decommission_zfs_target job type
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'decommission_zfs_target';