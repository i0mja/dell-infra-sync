-- Add hosting_vm_id to replication_targets to track which VM hosts the ZFS appliance
ALTER TABLE replication_targets 
ADD COLUMN IF NOT EXISTS hosting_vm_id uuid REFERENCES vcenter_vms(id);

-- Link existing NFS datastores to replication targets by naming convention
-- e.g., datastore "NFS-zfs-mar-vrep-02" links to target "zfs-mar-vrep-02"
UPDATE vcenter_datastores 
SET replication_target_id = rt.id
FROM replication_targets rt
WHERE vcenter_datastores.name ILIKE '%' || rt.name || '%'
  AND vcenter_datastores.type = 'NFS'
  AND vcenter_datastores.replication_target_id IS NULL;