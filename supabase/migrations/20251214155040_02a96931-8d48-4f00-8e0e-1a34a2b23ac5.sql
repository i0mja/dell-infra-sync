-- Backfill vm_vcenter_id for protected VMs by matching vm_name to vcenter_vms
UPDATE protected_vms p
SET vm_vcenter_id = v.vcenter_id
FROM vcenter_vms v
WHERE p.vm_name = v.name
  AND p.vm_vcenter_id IS NULL;