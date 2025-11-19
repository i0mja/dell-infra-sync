-- Add server_group_safety_check to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'server_group_safety_check';