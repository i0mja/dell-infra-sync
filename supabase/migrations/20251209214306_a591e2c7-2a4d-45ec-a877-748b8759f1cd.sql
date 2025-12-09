-- Add sync_protection_config to job_type enum for auto-syncing protection group settings to ZFS appliances
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'sync_protection_config';