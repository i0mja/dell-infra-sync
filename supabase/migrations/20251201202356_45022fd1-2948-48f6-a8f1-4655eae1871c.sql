-- Drop the current vcenter_id-only unique constraint (problematic for multi-vCenter)
ALTER TABLE vcenter_hosts DROP CONSTRAINT IF EXISTS vcenter_hosts_vcenter_id_key;

-- Add composite unique constraint (vcenter_id unique per vCenter)
ALTER TABLE vcenter_hosts ADD CONSTRAINT vcenter_hosts_vcenter_source_unique 
  UNIQUE(vcenter_id, source_vcenter_id);