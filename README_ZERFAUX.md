# Zerfaux – ZFS-backed DR Orchestration for vSphere

Zerfaux is a disaster recovery orchestration module for VMware vSphere that uses
ZFS replication (snapshots + send/receive) as the transport. It is designed to
run fully offline, using Supabase Postgres as its metadata store, and integrates
as a feature inside the main application.

> **Key idea:** Zerfaux gives you a Zerto-like flow (Protection Groups, DR Shell
> VMs, job tracking) without requiring external SaaS or proprietary DR products.

---

## Features

- **vCenter inventory sync** (stub now → real pyVmomi / vSphere REST later)
- **ZFS replication orchestration** (stub now → real `syncoid` / `zfs send` later)
- **Protection Groups** for grouping VMs and DR policies
- **Protection Datastore Wizard** to ensure VMs live on the right datastore
- **DR Shell VM Wizard** to pre-stage VMs at the DR vCenter
- **Replication job tracking** with status and details
- **Supabase-local persistence** (works with local Supabase Docker, air-gapped)

Implementation details are defined in `PLAN_ZERFAUX.md`.

---

## Architecture (High Level)

Zerfaux has three main layers:

1. **Metadata Layer (Supabase Postgres)**  
   Tracks vCenters, VMs, ZFS targets, Protection Groups, Protected VMs and jobs.

2. **Orchestration Layer (Backend)**  
   Exposes `/api/replication` endpoints, implements workflow and wizard logic,
   and currently uses stub functions that simulate success.

3. **UI Layer (React)**  
   Provides a `/replication` page with:
   - vCenter panel
   - VM inventory
   - Protection Groups + Protected VMs
   - Replication Jobs
   - Protection Datastore Wizard
   - DR Shell VM Wizard

See `ZERFAUX_ARCHITECTURE.mermaid` for a diagram.

---

## Data Model (Summary)

Defined in detail in `PLAN_ZERFAUX.md`, Zerfaux uses the following core tables:

- `vcenter_connections` – vCenter endpoints & credentials
- `vms` – inventory of VMs discovered from vCenter
- `replication_targets` – Debian/ZFS replication appliances
- `protection_groups` – DR policy units (source VC, DR VC, datastore hints, RPO)
- `protected_vms` – membership of VMs in Protection Groups, DR shell status
- `replication_jobs` – history of replication, storage moves, DR shell actions

All of these live in Supabase Postgres and are created via migrations.

---

## API (Summary)

All Zerfaux backend routes live under `/api/replication`:

- vCenter CRUD + `/vcenters/{id}/sync`
- VM inventory: `/vcenters/{id}/vms`
- Replication targets CRUD
- Protection groups CRUD
- Protected VMs assign/list
- Replication jobs list and `/protection-groups/{id}/run-now`
- Wizard endpoints:
  - `/protected-vms/{id}/protection-plan`
  - `/protected-vms/{id}/move-to-protection-datastore`
  - `/protected-vms/{id}/dr-shell-plan`
  - `/protected-vms/{id}/create-dr-shell`

Detailed request/response shapes are in `ZERFAUX_API_LOGIC.md`.

---

## Wizards

### Protection Datastore Wizard

Goal: ensure a VM resides on the protection datastore before replication.

- Step 1: Show current vs required datastore
- Step 2: If needed, simulate Storage vMotion
- Step 3: Mark VM as compliant (`in_protection_datastore = true`)

**Future real implementation:**

- Use VMware Storage vMotion via pyVmomi or vSphere REST
- Build `RelocateSpec`, call `vm.Relocate()`, wait for completion

### DR Shell VM Wizard

Goal: pre-create a shell VM at DR vCenter, pointing at replicated disks.

- Step 1: Show proposed shell VM plan (name, hints)
- Step 2: Confirm shell name (and later DR placement overrides)
- Step 3: Simulate creation; mark `dr_shell_status = 'created'`

**Future real implementation:**

- Use pyVmomi to build a `ConfigSpec`
- Attach VMDKs on the DR ZFS-backed datastore
- Call `CreateVM_Task` and store resulting MOID

---

## Development Phases

Zerfaux is designed to be enabled incrementally:

1. **Phase 1:** Supabase tables, backend stubs, full UI (what this repo ships)
2. **Phase 2:** Real ZFS replication engine using SSH / `syncoid`
3. **Phase 3:** Real Storage vMotion integration
4. **Phase 4:** Real DR shell VM creation and disk attach
5. **Phase 5:** Test failover workflows
6. **Phase 6:** Full DR cutover and rollback workflows

---

## VMware SDK References

These are used in the **future** real implementation (not in the current stubs):

- pyVmomi (vSphere Web Services SDK)  
  - https://github.com/vmware/pyvmomi  
  - Samples: https://github.com/vmware/pyvmomi/tree/master/samples
- vSphere Automation SDK for REST  
  - https://github.com/vmware/vsphere-automation-sdk-rest  
  - API reference: https://developer.vmware.com/apis/vsphere-automation/latest/

---

## How to Work on Zerfaux

1. Read `PLAN_ZERFAUX.md` to understand the detailed plan.
2. Read `ZERFAUX_API_LOGIC.md` for endpoint and flow specifics.
3. Use local Supabase (`supabase start`) – no cloud dependencies.
4. Use the `/replication` page as the primary UI entry point.
5. Keep all VMware/ZFS calls stubbed until you intentionally move to a “real” phase.
