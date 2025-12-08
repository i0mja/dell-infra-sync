-- Add onboard_zfs_target job type for unified ZFS target onboarding wizard
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'onboard_zfs_target';