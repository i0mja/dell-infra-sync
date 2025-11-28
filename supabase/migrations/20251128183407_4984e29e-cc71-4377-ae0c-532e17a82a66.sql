-- Add browse_datastore to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'browse_datastore';