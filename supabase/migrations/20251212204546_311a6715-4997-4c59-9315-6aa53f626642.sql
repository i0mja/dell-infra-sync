-- Add scan_datastore_status job type for real-time datastore status scanning
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'scan_datastore_status';