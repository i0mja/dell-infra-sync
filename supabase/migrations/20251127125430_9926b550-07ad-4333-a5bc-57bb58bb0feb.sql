-- Add console_launch job type to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'console_launch';