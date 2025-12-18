-- Add scheduled_vcenter_sync to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'scheduled_vcenter_sync';

-- Change default sync_interval_minutes from 60 to 15
ALTER TABLE vcenters ALTER COLUMN sync_interval_minutes SET DEFAULT 15;