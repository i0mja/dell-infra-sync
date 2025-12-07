-- Drop the old constraint that references vcenter_settings
ALTER TABLE zfs_target_templates 
DROP CONSTRAINT IF EXISTS zfs_target_templates_vcenter_id_fkey;

-- Add the correct constraint pointing to vcenters table
ALTER TABLE zfs_target_templates 
ADD CONSTRAINT zfs_target_templates_vcenter_id_fkey 
FOREIGN KEY (vcenter_id) REFERENCES vcenters(id) ON DELETE CASCADE;