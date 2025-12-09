-- Add partner_target_id to replication_targets for ZFS target pairing
ALTER TABLE public.replication_targets 
ADD COLUMN partner_target_id uuid REFERENCES public.replication_targets(id);

-- Add replication_target_id to vcenter_datastores for datastore-to-appliance linking
ALTER TABLE public.vcenter_datastores 
ADD COLUMN replication_target_id uuid REFERENCES public.replication_targets(id);

-- Add DR destination fields to protection_groups
ALTER TABLE public.protection_groups
ADD COLUMN dr_datastore text,
ADD COLUMN dr_dataset text;

-- Create index for efficient lookups
CREATE INDEX idx_datastores_replication_target ON public.vcenter_datastores(replication_target_id);
CREATE INDEX idx_targets_partner ON public.replication_targets(partner_target_id);