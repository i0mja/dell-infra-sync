-- Add columns for better ZFS transfer tracking

-- Add expected_bytes and site_b_verified to replication_jobs
ALTER TABLE replication_jobs
ADD COLUMN IF NOT EXISTS expected_bytes bigint,
ADD COLUMN IF NOT EXISTS site_b_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS incremental_from text;

-- Add last_snapshot_name and site_b_verified to protected_vms
ALTER TABLE protected_vms
ADD COLUMN IF NOT EXISTS last_snapshot_name text,
ADD COLUMN IF NOT EXISTS site_b_verified boolean DEFAULT false;