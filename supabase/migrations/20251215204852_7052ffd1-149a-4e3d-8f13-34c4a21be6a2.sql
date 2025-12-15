-- Add failover job types to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'failover_preflight_check';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'group_failover';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'test_failover';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'commit_failover';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'rollback_failover';

-- Add failover tracking columns to protected_vms
ALTER TABLE protected_vms 
  ADD COLUMN IF NOT EXISTS failover_ready BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_failover_check TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failover_check_result JSONB,
  ADD COLUMN IF NOT EXISTS failover_status TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS last_failover_at TIMESTAMPTZ;

-- Add comment for failover_status values
COMMENT ON COLUMN protected_vms.failover_status IS 'Status: normal, failing_over, failed_over, rolling_back';

-- Add failover columns to protection_groups
ALTER TABLE protection_groups 
  ADD COLUMN IF NOT EXISTS failover_status TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS last_failover_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failover_type TEXT,
  ADD COLUMN IF NOT EXISTS active_failover_event_id UUID;

-- Add foreign key for active failover event
DO $$ BEGIN
  ALTER TABLE protection_groups 
    ADD CONSTRAINT protection_groups_active_failover_event_fkey 
    FOREIGN KEY (active_failover_event_id) 
    REFERENCES failover_events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add network mapping table for failover
CREATE TABLE IF NOT EXISTS protection_group_network_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protection_group_id UUID NOT NULL REFERENCES protection_groups(id) ON DELETE CASCADE,
  source_network TEXT NOT NULL,
  target_network TEXT NOT NULL,
  is_test_network BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE protection_group_network_mappings ENABLE ROW LEVEL SECURITY;

-- RLS policies for network mappings
CREATE POLICY "Allow authenticated users to view network mappings" 
ON protection_group_network_mappings FOR SELECT 
TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to manage network mappings" 
ON protection_group_network_mappings FOR ALL 
TO authenticated USING (true) WITH CHECK (true);