-- Add progress column to job_tasks table for granular progress tracking
ALTER TABLE job_tasks ADD COLUMN progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100);

-- Add index for faster queries on running tasks with progress
CREATE INDEX idx_job_tasks_progress ON job_tasks(job_id, status, progress) WHERE status = 'running';