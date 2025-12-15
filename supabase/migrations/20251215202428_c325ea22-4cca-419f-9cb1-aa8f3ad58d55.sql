-- Add new job types for SLA monitoring
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'scheduled_replication_check';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'rpo_monitoring';

-- Create SLA violations tracking table
CREATE TABLE IF NOT EXISTS public.sla_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protection_group_id UUID REFERENCES protection_groups(id) ON DELETE CASCADE,
  violation_type TEXT NOT NULL, -- 'rpo_breach', 'test_overdue', 'sync_failed', 'journal_mismatch'
  severity TEXT DEFAULT 'warning', -- 'warning', 'critical'
  detected_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  details JSONB,
  notification_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on sla_violations
ALTER TABLE public.sla_violations ENABLE ROW LEVEL SECURITY;

-- RLS policies for sla_violations
CREATE POLICY "Authenticated users can view sla_violations"
  ON public.sla_violations
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert sla_violations"
  ON public.sla_violations
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update sla_violations"
  ON public.sla_violations
  FOR UPDATE
  USING (true);

-- Add next_scheduled_sync column if not exists (for showing countdown in UI)
ALTER TABLE public.protection_groups 
  ADD COLUMN IF NOT EXISTS next_scheduled_sync TIMESTAMPTZ;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_sla_violations_group_type 
  ON public.sla_violations(protection_group_id, violation_type);

CREATE INDEX IF NOT EXISTS idx_sla_violations_unresolved 
  ON public.sla_violations(protection_group_id) 
  WHERE resolved_at IS NULL;