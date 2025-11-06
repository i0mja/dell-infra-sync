-- Add 'full_server_update' to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'full_server_update';

-- Add parent_job_id column to jobs table to link sub-jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES jobs(id) ON DELETE CASCADE;

-- Add component_order column to track which component this job updates
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS component_order INTEGER;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_jobs_parent_job_id ON jobs(parent_job_id);