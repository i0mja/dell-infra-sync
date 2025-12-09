-- Add prepare_zfs_template job type for template preparation wizard
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'prepare_zfs_template';

-- Add clone_zfs_template job type for cloning templates during onboarding
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'clone_zfs_template';