-- Add create_dr_shell job type for DR Shell VM creation via job queue
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'create_dr_shell';