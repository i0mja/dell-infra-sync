-- ============================================
-- ZFS Agent API & Dynamic Disk Provisioning Schema
-- ============================================

-- Table: zfs_agents - Agent registration and heartbeat
CREATE TABLE public.zfs_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID REFERENCES public.replication_targets(id) ON DELETE SET NULL,
  hostname TEXT NOT NULL,
  agent_version TEXT,
  api_url TEXT, -- Full URL e.g., https://192.168.1.50:8000
  api_port INTEGER DEFAULT 8000,
  api_protocol TEXT DEFAULT 'https',
  last_seen_at TIMESTAMPTZ,
  capabilities JSONB DEFAULT '{}',
  status TEXT DEFAULT 'unknown' CHECK (status IN ('online', 'idle', 'busy', 'offline', 'unknown')),
  pool_name TEXT,
  pool_size_bytes BIGINT,
  pool_free_bytes BIGINT,
  pool_health TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: agent_jobs - Local job tracking from agents
CREATE TABLE public.agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.zfs_agents(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('snapshot', 'replication', 'export', 'repair', 'prune', 'pool_init', 'health_check')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  bytes_transferred BIGINT,
  details JSONB DEFAULT '{}',
  logs TEXT[],
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: agent_events - Events/alerts from agents
CREATE TABLE public.agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.zfs_agents(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'pool_degraded', 'pool_healthy', 'snapshot_created', 'snapshot_failed',
    'replication_started', 'replication_completed', 'replication_failed',
    'threshold_exceeded', 'disk_error', 'agent_started', 'agent_stopped'
  )),
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  message TEXT NOT NULL,
  details JSONB,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns to zfs_target_templates for dynamic disk sizing
ALTER TABLE public.zfs_target_templates 
  ADD COLUMN IF NOT EXISTS headroom_percent INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS min_disk_gb INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_disk_gb INTEGER DEFAULT 10000;

-- Add columns to replication_targets for agent + provisioning metadata
ALTER TABLE public.replication_targets
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.zfs_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provisioned_disk_gb INTEGER,
  ADD COLUMN IF NOT EXISTS protection_group_id UUID REFERENCES public.protection_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS headroom_percent INTEGER,
  ADD COLUMN IF NOT EXISTS vm_count_at_provisioning INTEGER,
  ADD COLUMN IF NOT EXISTS source_vm_storage_bytes BIGINT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_zfs_agents_target_id ON public.zfs_agents(target_id);
CREATE INDEX IF NOT EXISTS idx_zfs_agents_status ON public.zfs_agents(status);
CREATE INDEX IF NOT EXISTS idx_zfs_agents_last_seen ON public.zfs_agents(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_agent_id ON public.agent_jobs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON public.agent_jobs(status);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_created_at ON public.agent_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent_id ON public.agent_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_severity ON public.agent_events(severity);
CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON public.agent_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replication_targets_agent_id ON public.replication_targets(agent_id);
CREATE INDEX IF NOT EXISTS idx_replication_targets_protection_group_id ON public.replication_targets(protection_group_id);

-- Enable RLS
ALTER TABLE public.zfs_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for zfs_agents
CREATE POLICY "Allow authenticated read access to zfs_agents"
  ON public.zfs_agents FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow operators and admins to manage zfs_agents"
  ON public.zfs_agents FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'operator')
    )
  );

-- RLS Policies for agent_jobs
CREATE POLICY "Allow authenticated read access to agent_jobs"
  ON public.agent_jobs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow operators and admins to manage agent_jobs"
  ON public.agent_jobs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'operator')
    )
  );

-- RLS Policies for agent_events
CREATE POLICY "Allow authenticated read access to agent_events"
  ON public.agent_events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow operators and admins to manage agent_events"
  ON public.agent_events FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'operator')
    )
  );

-- Trigger to update updated_at
CREATE TRIGGER update_zfs_agents_updated_at
  BEFORE UPDATE ON public.zfs_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to upsert agent heartbeat (called by agents)
CREATE OR REPLACE FUNCTION public.upsert_agent_heartbeat(
  p_hostname TEXT,
  p_agent_version TEXT,
  p_api_url TEXT,
  p_capabilities JSONB DEFAULT '{}',
  p_pool_name TEXT DEFAULT NULL,
  p_pool_size_bytes BIGINT DEFAULT NULL,
  p_pool_free_bytes BIGINT DEFAULT NULL,
  p_pool_health TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id UUID;
BEGIN
  -- Try to find existing agent by hostname
  SELECT id INTO v_agent_id
  FROM zfs_agents
  WHERE hostname = p_hostname;
  
  IF v_agent_id IS NULL THEN
    -- Create new agent
    INSERT INTO zfs_agents (
      hostname, agent_version, api_url, capabilities, 
      pool_name, pool_size_bytes, pool_free_bytes, pool_health,
      status, last_seen_at
    ) VALUES (
      p_hostname, p_agent_version, p_api_url, p_capabilities,
      p_pool_name, p_pool_size_bytes, p_pool_free_bytes, p_pool_health,
      'online', NOW()
    )
    RETURNING id INTO v_agent_id;
  ELSE
    -- Update existing agent
    UPDATE zfs_agents
    SET 
      agent_version = p_agent_version,
      api_url = p_api_url,
      capabilities = p_capabilities,
      pool_name = COALESCE(p_pool_name, pool_name),
      pool_size_bytes = COALESCE(p_pool_size_bytes, pool_size_bytes),
      pool_free_bytes = COALESCE(p_pool_free_bytes, pool_free_bytes),
      pool_health = COALESCE(p_pool_health, pool_health),
      status = 'online',
      last_seen_at = NOW()
    WHERE id = v_agent_id;
  END IF;
  
  RETURN v_agent_id;
END;
$$;

-- Function to mark stale agents as offline
CREATE OR REPLACE FUNCTION public.mark_stale_agents_offline()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE zfs_agents
  SET status = 'offline'
  WHERE status IN ('online', 'idle', 'busy')
    AND last_seen_at < NOW() - INTERVAL '5 minutes';
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;