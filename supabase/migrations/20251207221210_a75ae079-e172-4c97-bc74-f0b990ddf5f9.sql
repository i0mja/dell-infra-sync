-- Add use_template_disk column to zfs_target_templates
ALTER TABLE zfs_target_templates
ADD COLUMN use_template_disk BOOLEAN DEFAULT false;

COMMENT ON COLUMN zfs_target_templates.use_template_disk IS 
  'If true, skip adding a new disk during deployment and use the existing second disk from the template';