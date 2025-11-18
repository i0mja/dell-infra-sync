-- Add new workflow orchestration job types
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'prepare_host_for_update';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'verify_host_after_update';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'rolling_cluster_update';

-- Create workflow execution tracking table
CREATE TABLE IF NOT EXISTS workflow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  workflow_type text NOT NULL,
  cluster_id text,
  host_id uuid REFERENCES vcenter_hosts(id) ON DELETE SET NULL,
  server_id uuid REFERENCES servers(id) ON DELETE SET NULL,
  step_number integer NOT NULL,
  step_name text NOT NULL,
  step_status text NOT NULL CHECK (step_status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  step_started_at timestamptz,
  step_completed_at timestamptz,
  step_details jsonb,
  step_error text,
  created_at timestamptz DEFAULT now()
);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_workflow_executions_job_id ON workflow_executions(job_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_type ON workflow_executions(workflow_type);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_step_status ON workflow_executions(step_status);

-- Enable RLS
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view workflow executions"
  ON workflow_executions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert workflow executions"
  ON workflow_executions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins and operators can update workflow executions"
  ON workflow_executions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'operator')
    )
  );

COMMENT ON TABLE workflow_executions IS 'Tracks individual steps in workflow orchestration jobs';
COMMENT ON COLUMN workflow_executions.workflow_type IS 'Type of workflow: prepare, verify, rolling_update';
COMMENT ON COLUMN workflow_executions.step_status IS 'Status of workflow step: pending, running, completed, failed, skipped';