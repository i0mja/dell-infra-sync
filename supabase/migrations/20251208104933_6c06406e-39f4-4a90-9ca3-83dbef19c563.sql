-- Add validate_zfs_template job type for prerequisite validation
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'validate_zfs_template';