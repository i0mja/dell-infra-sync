-- Create notification logs table to track all notification deliveries
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notification_type TEXT NOT NULL CHECK (notification_type IN ('email', 'teams')),
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  delivery_details JSONB,
  is_test BOOLEAN NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Admins can view all notification logs
CREATE POLICY "Admins can view notification logs"
  ON public.notification_logs
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- System can insert notification logs
CREATE POLICY "System can insert notification logs"
  ON public.notification_logs
  FOR INSERT
  WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON public.notification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_job_id ON public.notification_logs(job_id) WHERE job_id IS NOT NULL;