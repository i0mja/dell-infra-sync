-- Add recurring schedule support to maintenance_windows
ALTER TABLE maintenance_windows
ADD COLUMN IF NOT EXISTS recurrence_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS recurrence_pattern text,
ADD COLUMN IF NOT EXISTS recurrence_type text CHECK (recurrence_type IN ('daily', 'weekly', 'monthly', 'custom')),
ADD COLUMN IF NOT EXISTS last_executed_at timestamp with time zone;

-- Create index for efficient recurring window lookups
CREATE INDEX IF NOT EXISTS idx_maintenance_windows_recurring 
ON maintenance_windows(recurrence_enabled, last_executed_at) 
WHERE recurrence_enabled = true;

-- Add pg_cron extension if not exists
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the execute-maintenance-windows function to run every 15 minutes
-- This will check for both one-time and recurring maintenance windows
SELECT cron.schedule(
  'execute-maintenance-windows',
  '*/15 * * * *',  -- Every 15 minutes
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/execute-maintenance-windows',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);