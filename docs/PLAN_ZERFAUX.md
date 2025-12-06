# PLAN_ZERFAUX.md
Zerfaux is a DR orchestration module for VMware vSphere using ZFS replication. 
This plan outlines architecture, components, workflows, API design, UI modules, 
and integration requirements for implementing Zerfaux inside the dell-server-manager app.

## 1. Overview
Zerfaux provides:
- vCenter inventory sync (stub -> real pyVmomi/vSphere REST)
- ZFS replication orchestration (stub -> real syncoid/zfs send)
- Protection Groups
- Protection Datastore Wizard
- DR Shell VM Wizard
- Replication Jobs tracking
- Full Supabase-local persistence

## 2. Core Components
### 2.1 Metadata (Supabase)
Tables:
- vcenter_connections
- vms
- replication_targets
- protection_groups
- protected_vms
- replication_jobs

### 2.2 Backend API
Prefix: /api/replication
Modules:
- vcenter_inventory (stub now)
- zerfaux_replication (stub now)

### 2.3 Frontend
Route: /replication
Panels:
- vCenter list
- VM inventory
- Protection Groups + Protected VMs
- Replication Jobs
- Wizards (Protection Datastore, DR Shell VM)

## 3. Wizards
### 3.1 Protection Datastore Wizard
Purpose:
Ensure VM resides on correct datastore before replication.

Stub:
Simulated success.

Future:
Storage vMotion via pyVmomi RelocateSpec.

### 3.2 DR Shell VM Wizard
Purpose:
Create shell VM at DR vCenter using replicated disks.

Stub:
Simulated success.

Future:
CreateVM_Task + attach VMDKs.

## 4. Future Real Implementation (Engineering Roadmap)
Stage 1: Full UI + stub backend
Stage 2: Real ZFS replication engine
Stage 3: Storage vMotion automation
Stage 4: DR Shell VM create + attach disks
Stage 5: Test failover engine
Stage 6: Real DR cutover

## 5. References
VMware pyVmomi SDK: https://github.com/vmware/pyvmomi
VMware REST SDK: https://github.com/vmware/vsphere-automation-sdk-rest
