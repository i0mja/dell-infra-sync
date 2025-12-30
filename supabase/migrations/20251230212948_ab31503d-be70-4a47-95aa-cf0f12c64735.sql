-- Add new job types for repair operations
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'repair_data_transfer';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'repair_nfs_export';