-- Add default ZFS appliance template ("Gold Image") reference to vcenters table
ALTER TABLE vcenters 
ADD COLUMN IF NOT EXISTS default_zfs_template_id uuid REFERENCES zfs_target_templates(id) ON DELETE SET NULL;

-- Add comment for documentation
COMMENT ON COLUMN vcenters.default_zfs_template_id IS 
  'Default ZFS appliance template for this vCenter (the "gold image"). When set, deployment wizards auto-fill settings from this template.';