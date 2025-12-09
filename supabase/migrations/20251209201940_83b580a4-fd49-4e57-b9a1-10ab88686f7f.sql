-- Fix the foreign key constraint on replication_targets.dr_vcenter_id
-- It should reference vcenters table, not vcenter_settings

-- Drop the incorrect foreign key constraint
ALTER TABLE public.replication_targets 
DROP CONSTRAINT IF EXISTS replication_targets_dr_vcenter_id_fkey;

-- Add the correct foreign key constraint referencing vcenters table
ALTER TABLE public.replication_targets 
ADD CONSTRAINT replication_targets_dr_vcenter_id_fkey 
FOREIGN KEY (dr_vcenter_id) REFERENCES public.vcenters(id) ON DELETE SET NULL;