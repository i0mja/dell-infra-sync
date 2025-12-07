-- Add deployment tracking columns to zfs_target_templates
ALTER TABLE zfs_target_templates
ADD COLUMN IF NOT EXISTS last_deployed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS deployment_count integer DEFAULT 0;

-- Add source tracking columns to replication_targets
ALTER TABLE replication_targets
ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES zfs_target_templates(id),
ADD COLUMN IF NOT EXISTS deployed_job_id uuid REFERENCES jobs(id),
ADD COLUMN IF NOT EXISTS deployed_vm_moref text,
ADD COLUMN IF NOT EXISTS deployed_ip_source text DEFAULT 'dhcp';

-- Create function to increment template deployment count
CREATE OR REPLACE FUNCTION public.increment_template_deployment(template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE zfs_target_templates
  SET 
    deployment_count = COALESCE(deployment_count, 0) + 1,
    last_deployed_at = now()
  WHERE id = template_id;
END;
$$;