-- Phase 1: Zerto-Inspired Replication Schema Updates

-- ============================================================
-- 1. Create replication_pairs table (source → destination configuration)
-- ============================================================
CREATE TABLE replication_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- Source Site Configuration
  source_target_id UUID REFERENCES replication_targets(id) ON DELETE SET NULL,
  source_vcenter_id UUID REFERENCES vcenters(id) ON DELETE SET NULL,
  
  -- Destination Site Configuration  
  destination_target_id UUID REFERENCES replication_targets(id) ON DELETE SET NULL,
  destination_vcenter_id UUID REFERENCES vcenters(id) ON DELETE SET NULL,
  
  -- Dataset Configuration
  source_dataset TEXT,
  destination_dataset TEXT,
  
  -- Replication Method
  replication_method TEXT DEFAULT 'zfs_send',
  use_compression BOOLEAN DEFAULT true,
  use_encryption BOOLEAN DEFAULT false,
  
  -- Status Tracking
  connection_status TEXT DEFAULT 'unknown',
  last_connection_test TIMESTAMPTZ,
  last_connection_error TEXT,
  bytes_transferred_total BIGINT DEFAULT 0,
  
  -- Audit
  is_enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT different_targets CHECK (
    source_target_id IS NULL OR 
    destination_target_id IS NULL OR 
    source_target_id != destination_target_id
  )
);

-- ============================================================
-- 2. Enhance protection_groups table
-- ============================================================
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS replication_pair_id UUID REFERENCES replication_pairs(id) ON DELETE SET NULL;
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'initializing';
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS boot_order JSONB DEFAULT '[]';
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS current_rpo_seconds INTEGER;
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS journal_history_hours INTEGER DEFAULT 24;
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS test_reminder_days INTEGER DEFAULT 30;
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMPTZ;
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE protection_groups ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- ============================================================
-- 3. Enhance replication_targets table
-- ============================================================
ALTER TABLE replication_targets ADD COLUMN IF NOT EXISTS site_role TEXT DEFAULT 'primary';
ALTER TABLE replication_targets ADD COLUMN IF NOT EXISTS site_location TEXT;

-- ============================================================
-- 4. Create replication_metrics table (time-series performance data)
-- ============================================================
CREATE TABLE replication_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protection_group_id UUID NOT NULL REFERENCES protection_groups(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT now(),
  
  -- Performance Metrics
  iops INTEGER,                    
  throughput_mbps NUMERIC(10,2),   
  wan_traffic_mbps NUMERIC(10,2),  
  current_rpo_seconds INTEGER,     
  
  -- Sync Status
  pending_bytes BIGINT DEFAULT 0,  
  journal_used_bytes BIGINT DEFAULT 0
);

CREATE INDEX idx_replication_metrics_ts ON replication_metrics(protection_group_id, timestamp DESC);

-- ============================================================
-- 5. Create failover_events table (DR operations tracking)
-- ============================================================
CREATE TABLE failover_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protection_group_id UUID NOT NULL REFERENCES protection_groups(id) ON DELETE CASCADE,
  
  -- Failover Configuration
  failover_type TEXT NOT NULL,
  checkpoint_time TIMESTAMPTZ,  
  commit_policy TEXT DEFAULT 'manual',
  commit_delay_minutes INTEGER,
  
  -- Execution Status
  status TEXT DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  committed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  
  -- Options
  reverse_protection BOOLEAN DEFAULT false,
  shutdown_source_vms TEXT DEFAULT 'graceful',
  
  -- Test-specific
  test_network_id TEXT,
  
  -- Results
  vms_recovered INTEGER DEFAULT 0,
  error_message TEXT,
  
  -- Audit
  initiated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_failover_events_group ON failover_events(protection_group_id, created_at DESC);

-- ============================================================
-- 6. Add new job types for replication operations
-- ============================================================
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'test_replication_pair';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'pause_protection_group';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'resume_protection_group';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'test_failover';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'live_failover';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'commit_failover';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'rollback_failover';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'collect_replication_metrics';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'run_replication_sync';

-- ============================================================
-- 7. RLS Policies
-- ============================================================

-- replication_pairs RLS
ALTER TABLE replication_pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view replication_pairs" 
  ON replication_pairs FOR SELECT 
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage replication_pairs" 
  ON replication_pairs FOR ALL 
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- replication_metrics RLS
ALTER TABLE replication_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view replication_metrics" 
  ON replication_metrics FOR SELECT 
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert replication_metrics" 
  ON replication_metrics FOR INSERT 
  WITH CHECK (true);

-- failover_events RLS
ALTER TABLE failover_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view failover_events" 
  ON failover_events FOR SELECT 
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage failover_events" 
  ON failover_events FOR ALL 
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- ============================================================
-- 8. Update triggers
-- ============================================================
CREATE TRIGGER update_replication_pairs_updated_at
  BEFORE UPDATE ON replication_pairs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 9. Comments for documentation
-- ============================================================
COMMENT ON TABLE replication_pairs IS 'Configures source-to-destination site replication relationships';
COMMENT ON TABLE replication_metrics IS 'Time-series performance metrics for protection groups';
COMMENT ON TABLE failover_events IS 'Tracks DR failover operations (test, live, move)';
COMMENT ON COLUMN protection_groups.status IS 'Zerto-style status: meeting_sla, not_meeting_sla, initializing, syncing, paused, error';
COMMENT ON COLUMN protection_groups.priority IS 'Failover priority: low, medium, high, critical';
COMMENT ON COLUMN protection_groups.boot_order IS 'JSON array of boot groups with delays: [{group: 1, vm_ids: [...], delay_seconds: 30}]';