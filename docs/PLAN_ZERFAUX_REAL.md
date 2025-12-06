# PLAN_ZERFAUX_REAL.md

This plan defines the **real implementation logic** for the Zerfaux module.
It upgrades from the stub-mode architecture in PLAN_ZERFAUX.md and uses:
- pyVmomi to interact with VMware vCenter
- SSH + ZFS (or syncoid) for dataset replication
- Supabase as persistent state
- Config flag `USE_ZERFAUX_STUBS` to swap stub vs real logic

## 1. VCenterInventoryReal
- Replaces: VCenterInventoryStub
- Connects using pyVmomi (SmartConnect)
- Fetches:
  - VMs (name, MoRef, cluster, power state, datastore, guest OS)
  - Datastores (name, available space, used %)
- Upserts into Supabase:
  - vcenter_vms
  - vcenter_datastores

## 2. ZFSReplicationReal
- Replaces: ZFSReplicationStub
- Uses subprocess or Paramiko to run on `replication_targets.ssh_host`:
  - `zfs snapshot pool/dataset@snapname`
  - `zfs send -i lastsnap pool/dataset | ssh host zfs receive pool/dataset`
  - Or call `syncoid` directly
- Updates `replication_jobs` status and bytes transferred
- May run in a background thread

## 3. Storage vMotion Logic
- Function: `run_storage_move_for_protected_vm()`
- Uses pyVmomi:
  - Locate VM by MoRef
  - Locate target datastore by name
  - Build `RelocateSpec` and call `vm.Relocate()`
- On success:
  - Update `protected_vms.needs_storage_vmotion = false`
  - Update `vcenter_vms.datastore = protection_datastore`

## 4. DR Shell VM Logic
- Function: `run_create_dr_shell_for_protected_vm()`
- Uses pyVmomi:
  - Connect to `dr_vcenter_id`
  - Create a VM with `ConfigSpec`
  - Attach replicated VMDKs using `VirtualDiskFlatVer2BackingInfo`
  - Call `CreateVM_Task`
- On success:
  - Set `dr_shell_vm_id`, `dr_shell_vm_created = true`

## 5. Configuration Flag
- Environment variable: `ZERFAUX_USE_STUBS=true|false`
- Default: `true` (stub mode for offline testing)
- Set in: `job_executor/zerfaux/__init__.py`
- If `false`:
  - Uses `VCenterInventoryReal` and `ZFSReplicationReal`
  - Requires real vCenter and ZFS infrastructure

## 6. Implementation Status: COMPLETE
- [x] Configuration toggle in `__init__.py`
- [x] `VCenterInventoryReal` in `vcenter_inventory_real.py`
- [x] `ZFSReplicationReal` in `zfs_replication_real.py`
- [x] `api_router.py` updated to use toggle
- [x] Storage vMotion via `RelocateVM_Task`
- [x] DR Shell VM creation via `CreateVM_Task`
