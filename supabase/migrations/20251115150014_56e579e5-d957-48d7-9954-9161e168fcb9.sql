-- Add test_credentials job type for lightweight iDRAC connection testing
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'test_credentials';