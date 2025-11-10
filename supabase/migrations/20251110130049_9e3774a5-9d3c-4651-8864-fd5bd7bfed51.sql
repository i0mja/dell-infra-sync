-- Create activity_settings table
CREATE TABLE public.activity_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Retention & Cleanup
  log_retention_days INTEGER NOT NULL DEFAULT 30,
  auto_cleanup_enabled BOOLEAN NOT NULL DEFAULT true,
  last_cleanup_at TIMESTAMPTZ,
  
  -- Verbosity
  log_level TEXT NOT NULL DEFAULT 'all', -- 'all', 'errors_only', 'slow_only'
  slow_command_threshold_ms INTEGER NOT NULL DEFAULT 5000,
  
  -- Size Limits
  max_request_body_kb INTEGER NOT NULL DEFAULT 100,
  max_response_body_kb INTEGER NOT NULL DEFAULT 100,
  
  -- Alerts
  alert_on_failures BOOLEAN NOT NULL DEFAULT true,
  alert_on_slow_commands BOOLEAN NOT NULL DEFAULT false,
  
  -- Statistics
  keep_statistics BOOLEAN NOT NULL DEFAULT true,
  statistics_retention_days INTEGER NOT NULL DEFAULT 365
);

-- Only one settings record allowed
CREATE UNIQUE INDEX idx_activity_settings_singleton ON public.activity_settings ((true));

-- RLS Policies
ALTER TABLE public.activity_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage activity settings" 
  ON public.activity_settings
  FOR ALL 
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view activity settings" 
  ON public.activity_settings
  FOR SELECT 
  USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_activity_settings_updated_at 
  BEFORE UPDATE ON public.activity_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default settings
INSERT INTO public.activity_settings (
  log_retention_days,
  auto_cleanup_enabled,
  log_level,
  slow_command_threshold_ms,
  max_request_body_kb,
  max_response_body_kb,
  alert_on_failures,
  alert_on_slow_commands,
  keep_statistics,
  statistics_retention_days
) VALUES (
  30,
  true,
  'all',
  5000,
  100,
  100,
  true,
  false,
  true,
  365
);

-- Create cleanup function
CREATE OR REPLACE FUNCTION cleanup_activity_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  settings_record RECORD;
  cutoff_date TIMESTAMPTZ;
BEGIN
  -- Get settings
  SELECT * INTO settings_record FROM activity_settings LIMIT 1;
  
  IF NOT FOUND OR NOT settings_record.auto_cleanup_enabled THEN
    RETURN;
  END IF;
  
  cutoff_date := NOW() - (settings_record.log_retention_days || ' days')::INTERVAL;
  
  -- Delete old logs
  DELETE FROM idrac_commands WHERE created_at < cutoff_date;
  
  -- Update last cleanup timestamp
  UPDATE activity_settings SET last_cleanup_at = NOW();
END;
$$;

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup to run daily at 2 AM
SELECT cron.schedule(
  'cleanup-activity-logs-daily',
  '0 2 * * *',
  'SELECT cleanup_activity_logs()'
);