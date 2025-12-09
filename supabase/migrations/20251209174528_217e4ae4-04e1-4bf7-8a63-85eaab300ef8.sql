-- Add missing job types for ZFS target onboarding SSH operations
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'test_ssh_connection';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'detect_disks';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'retry_onboard_step';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'rollback_zfs_onboard';