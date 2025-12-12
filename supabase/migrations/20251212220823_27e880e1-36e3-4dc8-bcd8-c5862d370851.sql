-- Fix vcenter_vms constraint: moref is only unique within a vCenter, not globally

-- Drop the overly restrictive global unique constraint on vcenter_id (moref)
ALTER TABLE vcenter_vms 
DROP CONSTRAINT IF EXISTS vcenter_vms_vcenter_id_key;

-- Add the correct compound unique constraint (moref + source_vcenter = unique)
ALTER TABLE vcenter_vms 
ADD CONSTRAINT vcenter_vms_vcenter_moref_unique 
UNIQUE (vcenter_id, source_vcenter_id);