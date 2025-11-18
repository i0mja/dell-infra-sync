-- Add cluster_safety_check to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'cluster_safety_check';