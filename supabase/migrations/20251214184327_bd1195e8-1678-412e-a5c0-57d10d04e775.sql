-- Add byte tracking columns to protected_vms table
ALTER TABLE public.protected_vms 
ADD COLUMN IF NOT EXISTS last_sync_bytes bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_bytes_synced bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_dataset_size bigint;

-- Add transfer rate to replication_jobs for historical tracking
ALTER TABLE public.replication_jobs
ADD COLUMN IF NOT EXISTS transfer_rate_mbps numeric,
ADD COLUMN IF NOT EXISTS vm_sync_details jsonb DEFAULT '[]'::jsonb;

-- Add index for faster job queries
CREATE INDEX IF NOT EXISTS idx_replication_jobs_status_type 
ON public.replication_jobs(status, job_type);