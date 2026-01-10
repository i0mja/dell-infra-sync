-- Phase 12: Add SCSI controller type column to vcenter_vms
-- This enables DR Shell VMs to be created with matching storage controller type
ALTER TABLE public.vcenter_vms 
ADD COLUMN IF NOT EXISTS scsi_controller_type TEXT DEFAULT 'lsilogic';

COMMENT ON COLUMN public.vcenter_vms.scsi_controller_type IS 
  'Primary SCSI controller type: lsilogic, lsilogic-sas, pvscsi, or buslogic';