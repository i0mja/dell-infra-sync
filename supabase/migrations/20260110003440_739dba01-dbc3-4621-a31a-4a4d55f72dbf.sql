-- Add guest_id column to store vSphere guestId for VM creation
ALTER TABLE vcenter_vms ADD COLUMN IF NOT EXISTS guest_id text;

-- Add comment for clarity
COMMENT ON COLUMN vcenter_vms.guest_id IS 'vSphere guestId (e.g., rhel7_64Guest) for VM creation';