-- Add ssh_trust_established column to replication_targets
ALTER TABLE public.replication_targets ADD COLUMN IF NOT EXISTS ssh_trust_established boolean DEFAULT false;

-- Add sync_in_progress column to protection_groups  
ALTER TABLE public.protection_groups ADD COLUMN IF NOT EXISTS sync_in_progress boolean DEFAULT false;

-- Add next_scheduled_sync column to protection_groups
ALTER TABLE public.protection_groups ADD COLUMN IF NOT EXISTS next_scheduled_sync timestamptz;

-- Enable realtime on replication_jobs for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.replication_jobs;