-- Add status and version columns to zfs_target_templates for appliance library management
ALTER TABLE public.zfs_target_templates 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft' 
  CHECK (status IN ('draft', 'preparing', 'ready', 'deprecated')),
ADD COLUMN IF NOT EXISTS version text,
ADD COLUMN IF NOT EXISTS preparation_job_id uuid REFERENCES public.jobs(id),
ADD COLUMN IF NOT EXISTS last_deployed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS deployment_count integer NOT NULL DEFAULT 0;

-- Add index for filtering by status
CREATE INDEX IF NOT EXISTS idx_zfs_target_templates_status ON public.zfs_target_templates(status);

-- Comment on new columns
COMMENT ON COLUMN public.zfs_target_templates.status IS 'Template status: draft, preparing, ready, deprecated';
COMMENT ON COLUMN public.zfs_target_templates.version IS 'Version tag for the prepared appliance (e.g., v1.0.0, 2024.1)';
COMMENT ON COLUMN public.zfs_target_templates.preparation_job_id IS 'Reference to the job that prepared this template';
COMMENT ON COLUMN public.zfs_target_templates.last_deployed_at IS 'Timestamp of last deployment from this template';
COMMENT ON COLUMN public.zfs_target_templates.deployment_count IS 'Number of times this template has been deployed';