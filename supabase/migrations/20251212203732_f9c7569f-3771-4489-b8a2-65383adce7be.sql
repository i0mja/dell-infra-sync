-- Add manage_datastore job type for NFS datastore operations
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'manage_datastore';

-- Add datastore tracking columns to replication_targets
ALTER TABLE replication_targets ADD COLUMN IF NOT EXISTS datastore_name TEXT;
ALTER TABLE replication_targets ADD COLUMN IF NOT EXISTS nfs_export_path TEXT;