-- Add setting to control SLA monitoring job visibility in Activity Monitor
ALTER TABLE public.activity_settings 
ADD COLUMN IF NOT EXISTS show_sla_monitoring_jobs boolean DEFAULT false;

COMMENT ON COLUMN public.activity_settings.show_sla_monitoring_jobs IS 
  'When true, show scheduled_replication_check and rpo_monitoring jobs in Activity Monitor';