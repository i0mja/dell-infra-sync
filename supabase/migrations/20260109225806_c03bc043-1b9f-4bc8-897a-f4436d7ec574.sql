-- Add test failover timing columns to failover_events
ALTER TABLE failover_events 
ADD COLUMN IF NOT EXISTS test_duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS cleanup_scheduled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cleanup_job_id UUID REFERENCES jobs(id);