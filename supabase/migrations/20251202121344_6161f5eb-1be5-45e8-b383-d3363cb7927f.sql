-- Add idm_search_groups to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'idm_search_groups';