-- Backfill current_datastore for protected VMs by joining with vcenter_datastore_vms
UPDATE protected_vms p
SET current_datastore = ds.name
FROM vcenter_vms v
JOIN vcenter_datastore_vms dvm ON dvm.vm_id = v.id AND dvm.is_primary_datastore = true
JOIN vcenter_datastores ds ON ds.id = dvm.datastore_id
WHERE p.vm_name = v.name
  AND p.current_datastore IS NULL;