-- Create network_settings table for operational reliability
CREATE TABLE IF NOT EXISTS public.network_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Connection timeouts (in seconds)
  connection_timeout_seconds INTEGER NOT NULL DEFAULT 30,
  read_timeout_seconds INTEGER NOT NULL DEFAULT 60,
  operation_timeout_seconds INTEGER NOT NULL DEFAULT 300,
  
  -- Retry policy
  max_retry_attempts INTEGER NOT NULL DEFAULT 3,
  retry_backoff_type TEXT NOT NULL DEFAULT 'exponential' CHECK (retry_backoff_type IN ('exponential', 'linear', 'fixed')),
  retry_delay_seconds INTEGER NOT NULL DEFAULT 2,
  
  -- Connection pooling
  max_concurrent_connections INTEGER NOT NULL DEFAULT 5,
  
  -- Rate limiting  
  max_requests_per_minute INTEGER NOT NULL DEFAULT 60,
  
  -- Pre-job validation
  require_prereq_validation BOOLEAN NOT NULL DEFAULT true,
  
  -- Network monitoring
  monitor_latency BOOLEAN NOT NULL DEFAULT true,
  latency_alert_threshold_ms INTEGER NOT NULL DEFAULT 1000
);

-- Enable RLS
ALTER TABLE public.network_settings ENABLE ROW LEVEL SECURITY;

-- Admins can manage network settings
CREATE POLICY "Admins can manage network settings"
  ON public.network_settings
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Authenticated users can view network settings
CREATE POLICY "Authenticated users can view network settings"
  ON public.network_settings
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Create trigger for updated_at
CREATE TRIGGER update_network_settings_updated_at
  BEFORE UPDATE ON public.network_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings
INSERT INTO public.network_settings (id) VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;