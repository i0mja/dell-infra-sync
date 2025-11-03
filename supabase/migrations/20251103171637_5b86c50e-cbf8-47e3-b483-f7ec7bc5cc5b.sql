-- Create notification settings table
CREATE TABLE public.notification_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  smtp_host text,
  smtp_port integer DEFAULT 587,
  smtp_user text,
  smtp_password text,
  smtp_from_email text,
  teams_webhook_url text,
  notify_on_job_complete boolean DEFAULT true,
  notify_on_job_failed boolean DEFAULT true,
  notify_on_job_started boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can manage notification settings
CREATE POLICY "Admins can manage notification settings"
ON public.notification_settings
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Authenticated users can view settings (to know if notifications are enabled)
CREATE POLICY "Authenticated users can view notification settings"
ON public.notification_settings
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Add trigger for updated_at
CREATE TRIGGER update_notification_settings_updated_at
BEFORE UPDATE ON public.notification_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();