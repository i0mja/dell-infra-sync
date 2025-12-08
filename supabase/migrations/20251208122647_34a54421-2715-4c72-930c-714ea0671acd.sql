-- Add prepare_zfs_template job type for Template Readiness Wizard
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'prepare_zfs_template';