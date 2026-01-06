-- Fix notification_logs constraint to allow additional notification types
-- Drop the existing constraint and recreate with expanded list
ALTER TABLE public.notification_logs 
DROP CONSTRAINT IF EXISTS notification_logs_notification_type_check;

ALTER TABLE public.notification_logs
ADD CONSTRAINT notification_logs_notification_type_check 
CHECK (notification_type = ANY (ARRAY[
  'email'::text, 
  'teams'::text, 
  'cluster_safety_alert'::text, 
  'sla_violation_alert'::text,
  'maintenance_reminder'::text,
  'job_notification'::text
]));