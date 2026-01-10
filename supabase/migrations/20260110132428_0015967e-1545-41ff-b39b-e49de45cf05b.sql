-- Add firmware column to vcenter_vms table to store VM firmware type (bios/efi)
ALTER TABLE public.vcenter_vms 
ADD COLUMN IF NOT EXISTS firmware TEXT DEFAULT 'bios';

COMMENT ON COLUMN public.vcenter_vms.firmware IS 'VM firmware type: bios or efi';