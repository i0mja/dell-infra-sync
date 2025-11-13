-- Add severity tracking and critical job configuration to notification settings
ALTER TABLE notification_settings 
ADD COLUMN teams_mention_users TEXT,
ADD COLUMN mention_on_critical_failures BOOLEAN DEFAULT true,
ADD COLUMN critical_job_types TEXT[] DEFAULT '{firmware_update, full_server_update}';

-- Add severity field to notification logs for better tracking
ALTER TABLE notification_logs 
ADD COLUMN severity TEXT DEFAULT 'normal' CHECK (severity IN ('critical', 'high', 'normal', 'low'));