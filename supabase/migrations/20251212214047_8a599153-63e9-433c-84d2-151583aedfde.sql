-- Add check_zfs_target_health to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'check_zfs_target_health';