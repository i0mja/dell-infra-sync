-- Add vcenter_connectivity_test job type to the job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'vcenter_connectivity_test';