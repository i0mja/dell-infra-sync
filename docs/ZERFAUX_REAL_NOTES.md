# ZERFAUX_REAL_NOTES.md

This file maps stub functions to real implementations.

## VCenter Inventory

Stub:
- VCenterInventoryStub.sync_inventory

Replace with:
- VCenterInventoryReal.sync_inventory(vcenter_id, db)
  → Call pyVmomi SmartConnect
  → Fetch VMs and datastores
  → Upsert into Supabase tables

Reuses:
- job_executor/mixins/vcenter_ops.py

## ZFS Replication

Stub:
- ZFSReplicationStub.create_snapshot
- ZFSReplicationStub.replicate_dataset

Replace with:
- ZFSReplicationReal
  - Use subprocess/Paramiko to run:
    - zfs snapshot
    - zfs send | zfs receive
    - or syncoid

## Protection Datastore Wizard

Stub:
- VCenterInventoryStub.relocate_vm()

Replace with:
- run_storage_move_for_protected_vm()
  - Use RelocateSpec + RelocateVM_Task via pyVmomi

## DR Shell Wizard

Stub:
- ZFSReplicationStub.create_dr_shell_vm

Replace with:
- run_create_dr_shell_for_protected_vm()
  - Use pyVmomi:
    - Build ConfigSpec
    - Add disks (VMDKs)
    - CreateVM_Task
