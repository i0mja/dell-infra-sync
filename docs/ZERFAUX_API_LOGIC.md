# ZERFAUX_API_LOGIC.md (Updated for Real Logic)

This doc defines each Zerfaux endpoint and what the REAL logic does now.

## /vcenters/{id}/sync
- Calls VCenterInventoryReal.sync_inventory()
- Connects to vCenter via pyVmomi
- Populates:
  - vcenter_vms
  - vcenter_datastores

## /protection-groups/{pg_id}/run-now
- Triggers replication for all active protected VMs
- Calls ZFSReplicationReal.replicate_dataset()
- Uses SSH to run ZFS commands

## /protected-vms/{id}/move-to-protection-datastore
- Calls run_storage_move_for_protected_vm()
- Uses RelocateVM_Task to move VM to correct datastore

## /protected-vms/{id}/create-dr-shell
- Calls run_create_dr_shell_for_protected_vm()
- Uses CreateVM_Task to create new DR shell VM with attached VMDKs
