-- Add openmanage_sync to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'openmanage_sync';