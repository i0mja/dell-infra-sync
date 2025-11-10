-- Create idrac_commands table for live command monitoring
CREATE TABLE public.idrac_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  server_id UUID REFERENCES public.servers(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.job_tasks(id) ON DELETE CASCADE,
  
  -- Request details
  command_type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  full_url TEXT NOT NULL,
  request_headers JSONB,
  request_body JSONB,
  
  -- Response details
  status_code INTEGER,
  response_time_ms INTEGER,
  response_body JSONB,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  
  -- Context
  initiated_by UUID REFERENCES public.profiles(id),
  source TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_idrac_commands_timestamp ON public.idrac_commands(timestamp DESC);
CREATE INDEX idx_idrac_commands_server_id ON public.idrac_commands(server_id);
CREATE INDEX idx_idrac_commands_job_id ON public.idrac_commands(job_id);
CREATE INDEX idx_idrac_commands_success ON public.idrac_commands(success);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.idrac_commands;

-- Enable RLS
ALTER TABLE public.idrac_commands ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view commands" 
  ON public.idrac_commands
  FOR SELECT 
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert commands" 
  ON public.idrac_commands
  FOR INSERT 
  WITH CHECK (true);