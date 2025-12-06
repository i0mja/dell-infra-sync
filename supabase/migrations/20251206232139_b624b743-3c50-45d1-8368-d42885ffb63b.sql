-- Fix protection_groups foreign key to reference vcenters instead of vcenter_settings
ALTER TABLE protection_groups
DROP CONSTRAINT IF EXISTS protection_groups_source_vcenter_id_fkey;

ALTER TABLE protection_groups
ADD CONSTRAINT protection_groups_source_vcenter_id_fkey 
FOREIGN KEY (source_vcenter_id) REFERENCES vcenters(id) ON DELETE SET NULL;