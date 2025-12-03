-- Add job_executor_url column to activity_settings
ALTER TABLE activity_settings 
ADD COLUMN IF NOT EXISTS job_executor_url TEXT DEFAULT 'http://localhost:8081';