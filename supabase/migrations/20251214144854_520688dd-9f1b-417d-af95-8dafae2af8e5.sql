-- Add new repair-related job types for ZFS target health
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'repair_zfs_pool';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'repair_cross_site_ssh';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'repair_syncoid_cron';