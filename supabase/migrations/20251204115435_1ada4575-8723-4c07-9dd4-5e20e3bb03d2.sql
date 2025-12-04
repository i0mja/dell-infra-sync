-- Create user_activity table for quick user actions (not long-running jobs)
CREATE TABLE public.user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID REFERENCES public.profiles(id),
  activity_type TEXT NOT NULL,
  target_type TEXT,
  target_name TEXT,
  target_id UUID,
  details JSONB,
  success BOOLEAN DEFAULT true,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can view activity logs"
ON public.user_activity
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert activity logs"
ON public.user_activity
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete activity logs"
ON public.user_activity
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for common queries
CREATE INDEX idx_user_activity_timestamp ON public.user_activity(timestamp DESC);
CREATE INDEX idx_user_activity_type ON public.user_activity(activity_type);
CREATE INDEX idx_user_activity_user ON public.user_activity(user_id);