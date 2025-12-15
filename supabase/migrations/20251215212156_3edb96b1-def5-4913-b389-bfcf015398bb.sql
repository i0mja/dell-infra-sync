-- Create executor heartbeats table for tracking job executor status
CREATE TABLE public.executor_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executor_id TEXT NOT NULL UNIQUE,
  hostname TEXT,
  ip_address TEXT,
  version TEXT,
  capabilities JSONB DEFAULT '[]'::jsonb,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  poll_count INTEGER DEFAULT 0,
  jobs_processed INTEGER DEFAULT 0,
  startup_time TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.executor_heartbeats ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view heartbeats
CREATE POLICY "Authenticated users can view executor heartbeats"
ON public.executor_heartbeats
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Allow system to manage heartbeats (via service role key)
CREATE POLICY "System can manage executor heartbeats"
ON public.executor_heartbeats
FOR ALL
USING (true)
WITH CHECK (true);

-- Add index for quick lookups
CREATE INDEX idx_executor_heartbeats_last_seen ON public.executor_heartbeats(last_seen_at DESC);

-- Enable realtime for executor heartbeats
ALTER PUBLICATION supabase_realtime ADD TABLE public.executor_heartbeats;