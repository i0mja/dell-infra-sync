# vCenter Sync Optimization: PropertyCollector Implementation Plan

## Overview

Replace the current "chatty" vCenter sync implementation (6 separate phases, ~25,000+ SOAP calls) with VMware's PropertyCollector API pattern (1 batch fetch + alarms), reducing sync time from **3-5 minutes to 15-30 seconds**.

---

## 1. Problem Analysis

### Current Implementation Issues

The current sync in `job_executor/mixins/vcenter_ops.py` creates **6 separate ContainerViews** and iterates through each object individually:

| Sync Method | Lines | ContainerView Type | Property Access Pattern |
|-------------|-------|-------------------|------------------------|
| `sync_vcenter_clusters()` | 1032-1131 | `vim.ClusterComputeResource` | Individual `cluster.summary`, `cluster.configuration` |
| `sync_vcenter_vms()` | 1133-1376 | `vim.VirtualMachine` | Individual `vm.config`, `vm.runtime`, `vm.guest` |
| `sync_vcenter_datastores()` | 1429-1585 | `vim.Datastore` + extra DVS view | Individual `ds.summary`, `ds.host`, `ds.vm` |
| `sync_vcenter_networks()` | 1587-1770 | `vim.Network` + `vim.dvs.DistributedVirtualPortgroup` + DVS view | Individual `net.config` |
| `sync_vcenter_alarms()` | 1772-1899 | Multiple entity types | `entity.triggeredAlarmState` |
| `sync_vcenter_hosts()` | 1901-2200+ | `vim.HostSystem` | Individual `host.hardware`, `host.config`, `host.runtime` |

### Performance Impact (1500 VMs, 50 hosts, 20 datastores)

- ~1500 × 15 property accesses = ~22,500 SOAP calls for VMs alone
- Each property access is a separate network round-trip
- **Total estimated calls: 25,000+**
- **Estimated sync time: 3-5 minutes**

### Single Caller

All these methods are **only called from `vcenter_handlers.py`** in `_sync_single_vcenter()`. There are no other callers, making removal safe.

---

## 2. Solution: PropertyCollector Pattern

Replace 6 separate sync methods with **ONE PropertyCollector call** that fetches all inventory in a single batch.

### Key VMware Concepts

- **ContainerView**: A view that contains all objects of specified types
- **PropertyCollector**: An efficient API to fetch specific properties from multiple objects in one call
- **TraversalSpec**: Tells PropertyCollector how to navigate from the ContainerView to contained objects
- **PropertySpec**: Lists which properties to fetch for each object type

### Expected Performance

| Metric | Before | After |
|--------|--------|-------|
| ContainerViews created | 6-8 | 1 |
| SOAP calls | ~25,000+ | 2-5 |
| Sync time (1500 VMs) | 3-5 minutes | 15-30 seconds |
| Code lines | ~876 (5 methods) | ~200 (1 method) |

---

## 3. Files to Create

### `job_executor/mixins/vcenter_property_collector.py` (~300 lines)

New module encapsulating PropertyCollector logic.

```python
"""
VMware PropertyCollector-based inventory fetching.
Replaces multiple ContainerView iterations with a single batch fetch.
"""
from pyVmomi import vim, vmodl
from typing import Dict, List, Tuple, Any, Optional
import logging

logger = logging.getLogger(__name__)


def collect_vcenter_inventory(content) -> Dict[str, List[Tuple[Any, Dict]]]:
    """
    Fetch ALL vCenter inventory in ONE PropertyCollector call.
    
    Args:
        content: vCenter ServiceInstance content object
        
    Returns:
        {
            'vms': [(vm_obj, props_dict), ...],
            'hosts': [(host_obj, props_dict), ...],
            'clusters': [(cluster_obj, props_dict), ...],
            'datastores': [(ds_obj, props_dict), ...],
            'networks': [(net_obj, props_dict), ...],
            'dvportgroups': [(dvpg_obj, props_dict), ...],
            'dvswitches': [(dvs_obj, props_dict), ...],
        }
    """
    
def _build_property_specs() -> List[vim.PropertySpec]:
    """Build property specifications for each object type."""
    
def _build_traversal_spec(view_ref) -> vim.TraversalSpec:
    """Build traversal spec from ContainerView to objects."""
    
def _parse_object_content(obj_content) -> Tuple[Any, Dict]:
    """Parse ObjectContent into (object, properties_dict)."""
```

### Property Specifications

| Object Type | Properties to Fetch | Maps to DB Table |
|-------------|---------------------|------------------|
| `vim.VirtualMachine` | `name`, `config.uuid`, `config.hardware.numCPU`, `config.hardware.memoryMB`, `config.template`, `runtime.powerState`, `runtime.host`, `guest.ipAddress`, `guest.toolsStatus`, `guest.toolsVersionStatus`, `summary.config.guestFullName`, `summary.storage.uncommitted` | `vcenter_vms` |
| `vim.HostSystem` | `name`, `parent`, `hardware.systemInfo.serialNumber`, `hardware.systemInfo.otherIdentifyingInfo`, `config.product.version`, `config.product.build`, `runtime.connectionState`, `runtime.inMaintenanceMode` | `vcenter_hosts` |
| `vim.ClusterComputeResource` | `name`, `summary.totalCpu`, `summary.effectiveCpu`, `summary.totalMemory`, `summary.effectiveMemory`, `summary.numHosts`, `summary.numEffectiveHosts`, `summary.overallStatus`, `configuration.dasConfig.enabled`, `configuration.drsConfig.enabled`, `configuration.drsConfig.defaultVmBehavior` | `vcenter_clusters` |
| `vim.Datastore` | `name`, `summary.capacity`, `summary.freeSpace`, `summary.type`, `summary.accessible`, `summary.maintenanceMode`, `host`, `vm` | `vcenter_datastores` |
| `vim.Network` | `name`, `host`, `vm` | `vcenter_networks` |
| `vim.dvs.DistributedVirtualPortgroup` | `name`, `config.distributedVirtualSwitch`, `config.uplink`, `config.defaultPortConfig.vlan` | `vcenter_networks` |
| `vim.DistributedVirtualSwitch` | `name` | (lookup only) |

---

## 4. Files to Modify

### `job_executor/mixins/vcenter_ops.py`

#### REMOVE (876 lines total)

| Method | Lines | Reason |
|--------|-------|--------|
| `sync_vcenter_clusters()` | 1032-1131 (~100 lines) | Replaced by PropertyCollector |
| `sync_vcenter_vms()` | 1133-1376 (~244 lines) | Replaced by PropertyCollector |
| `sync_vcenter_datastores()` | 1429-1585 (~157 lines) | Replaced by PropertyCollector |
| `sync_vcenter_networks()` | 1587-1770 (~184 lines) | Replaced by PropertyCollector |
| `sync_vcenter_hosts()` | 1901-2200+ (~300 lines) | Replaced by PropertyCollector |

#### ADD (~200 lines)

```python
def sync_vcenter_fast(
    self,
    content,
    source_vcenter_id: str,
    vcenter_name: str = "",
    job_id: str = None,
    progress_callback: callable = None
) -> Dict:
    """
    Fast vCenter sync using PropertyCollector.
    Replaces 5 separate sync methods with one batch fetch.
    
    Args:
        content: vCenter ServiceInstance content
        source_vcenter_id: UUID of vCenter in database
        vcenter_name: Display name for logging
        job_id: Associated job ID for activity logging
        progress_callback: Optional callback for progress updates
        
    Returns:
        {
            'clusters': {'new': X, 'updated': Y},
            'vms': {'new': X, 'updated': Y},
            'hosts': {'new': X, 'updated': Y, 'auto_linked': Z},
            'datastores': {'new': X, 'updated': Y},
            'networks': {'new': X, 'updated': Y},
            'fetch_time_ms': 1234,
            'process_time_ms': 5678,
        }
    """
```

#### KEEP (unchanged)

| Method | Reason |
|--------|--------|
| `sync_vcenter_alarms()` | Uses AlarmManager API, not compatible with PropertyCollector |
| `_upsert_vm_batch()` | Reused by `sync_vcenter_fast()` |
| `_extract_serial_from_host()` | Reused for auto-linking logic |
| `connect_to_vcenter()` | Connection logic unchanged |
| All vCenter operation methods | Not part of sync |

---

### `job_executor/handlers/vcenter_handlers.py`

#### REMOVE

Lines ~243-450: 6 sequential sync phase calls:
```python
# REMOVE THIS:
clusters_result = self.executor.sync_vcenter_clusters(content, source_vcenter_id, ...)
datastores_result = self.executor.sync_vcenter_datastores(content, source_vcenter_id, ...)
networks_result = self.executor.sync_vcenter_networks(content, source_vcenter_id, ...)
vms_result = self.executor.sync_vcenter_vms(content, source_vcenter_id, ...)
alarms_result = self.executor.sync_vcenter_alarms(content, source_vcenter_id, ...)
hosts_result = self.executor.sync_vcenter_hosts(content, source_vcenter_id, ...)
```

#### ADD

2-phase sync approach:
```python
# Phase 1: Fast sync using PropertyCollector (replaces 5 sequential syncs)
self.log("📊 Fast syncing inventory with PropertyCollector...")
if 'inventory' in phase_tasks:
    self.update_task_status(phase_tasks['inventory'], 'running', 0, 
                           "Fetching all inventory...")

fast_result = self.executor.sync_vcenter_fast(
    content,
    source_vcenter_id,
    vcenter_name=vcenter_name,
    job_id=job['id'],
    progress_callback=lambda pct, msg: self.update_task_status(
        phase_tasks.get('inventory'), 'running', pct, msg
    )
)

if 'inventory' in phase_tasks:
    self.update_task_status(phase_tasks['inventory'], 'completed', 100,
                           f"Synced {fast_result.get('total_objects', 0)} objects")

# Phase 2: Alarms (separate - uses AlarmManager API)
self.log("🔔 Syncing alarms...")
if 'alarms' in phase_tasks:
    self.update_task_status(phase_tasks['alarms'], 'running', 0, "Checking alarms...")
    
alarms_result = self.executor.sync_vcenter_alarms(
    content, source_vcenter_id, vcenter_name, job['id']
)
```

#### UPDATE Phase Definitions

```python
# BEFORE: 7 phases
sync_phases = [
    {'name': 'connect', 'label': f'{phase_prefix}Connecting to vCenter'},
    {'name': 'clusters', 'label': f'{phase_prefix}Syncing clusters'},
    {'name': 'datastores', 'label': f'{phase_prefix}Syncing datastores'},
    {'name': 'networks', 'label': f'{phase_prefix}Syncing networks'},
    {'name': 'vms', 'label': f'{phase_prefix}Syncing VMs'},
    {'name': 'alarms', 'label': f'{phase_prefix}Syncing alarms'},
    {'name': 'hosts', 'label': f'{phase_prefix}Syncing ESXi hosts'}
]

# AFTER: 3 phases
sync_phases = [
    {'name': 'connect', 'label': f'{phase_prefix}Connecting to vCenter'},
    {'name': 'inventory', 'label': f'{phase_prefix}Fetching inventory (fast)'},
    {'name': 'alarms', 'label': f'{phase_prefix}Syncing alarms'}
]
```

---

### `job_executor/config.py`

#### ADD

```python
# PropertyCollector sync feature flag (for rollback capability)
USE_PROPERTY_COLLECTOR_SYNC = os.getenv('USE_PROPERTY_COLLECTOR_SYNC', 'true').lower() == 'true'
```

---

### `job-executor.py`

#### UPDATE

Update the mixin methods comment block to reflect removed methods:

```python
# VCenterMixin provides:
#   - connect_to_vcenter()
#   - sync_vcenter_fast()        # NEW: Replaces 5 individual sync methods
#   - sync_vcenter_alarms()
#   - enter_maintenance_mode()
#   - exit_maintenance_mode()
#   - ... other vCenter operations
```

---

## 5. Handling Edge Cases

### MoRef Resolution

Since we fetch ALL objects at once, build lookup maps for relationship resolution:

```python
def _build_moref_lookups(self, inventory: Dict) -> Dict:
    """Build MoRef → data maps for relationship resolution."""
    lookups = {
        'host_moref_to_cluster': {},   # str(host.parent._moId) → cluster_name
        'cluster_moref_to_name': {},   # str(cluster._moId) → cluster_name
        'host_moref_to_name': {},      # str(host._moId) → host_name
        'dvs_moref_to_name': {},       # str(dvs._moId) → dvs_name
    }
    
    # Build cluster lookup
    for cluster_obj, props in inventory.get('clusters', []):
        moref = str(cluster_obj._moId)
        lookups['cluster_moref_to_name'][moref] = props.get('name', '')
    
    # Build DVS lookup
    for dvs_obj, props in inventory.get('dvswitches', []):
        moref = str(dvs_obj._moId)
        lookups['dvs_moref_to_name'][moref] = props.get('name', '')
    
    return lookups
```

### Host→Cluster Resolution

```python
# PropertyCollector returns host.parent as MoRef
host_parent = props.get('parent')
if host_parent:
    parent_moref = str(host_parent._moId)
    cluster_name = lookups['cluster_moref_to_name'].get(parent_moref, '')
```

### VM→Host Resolution

```python
# PropertyCollector returns vm.runtime.host as MoRef
vm_host = props.get('runtime.host')
if vm_host:
    host_moref = str(vm_host._moId)
    host_name = lookups['host_moref_to_name'].get(host_moref, '')
```

### Serial Number Extraction (for Auto-linking)

Reuse existing `_extract_serial_from_host()` logic:

```python
def _extract_serial_from_host(self, props: Dict) -> Optional[str]:
    """Extract Dell Service Tag from host properties."""
    # Check direct serial number
    serial = props.get('hardware.systemInfo.serialNumber')
    if serial and serial.strip():
        return serial.strip()
    
    # Check otherIdentifyingInfo for Dell Service Tag
    other_info = props.get('hardware.systemInfo.otherIdentifyingInfo', [])
    for info in other_info or []:
        if hasattr(info, 'identifierType') and hasattr(info, 'identifierValue'):
            if 'ServiceTag' in str(info.identifierType):
                return info.identifierValue.strip()
    
    return None
```

### Alarms (Separate Handling)

Alarms require the `AlarmManager` API and cannot be batched via PropertyCollector:

```python
# This stays as-is
def sync_vcenter_alarms(self, content, source_vcenter_id, vcenter_name="", job_id=None):
    """Sync triggered alarms from vCenter - uses AlarmManager API."""
    alarm_manager = content.alarmManager
    # ... existing implementation
```

---

## 6. Performance Logging

### Timing Logs

```python
import time

start_fetch = time.time()
inventory = collect_vcenter_inventory(content)
fetch_time = time.time() - start_fetch

start_process = time.time()
# ... process and upsert
process_time = time.time() - start_process

total_objects = sum(len(v) for v in inventory.values())
self.log(f"PropertyCollector: fetched {total_objects} objects in {fetch_time:.2f}s")
self.log(f"Database upserts completed in {process_time:.2f}s")
self.log(f"Total fast sync: {fetch_time + process_time:.2f}s")
```

### Activity Logging

Log to `idrac_commands` with `operation_type='vcenter_api'`:

```python
self.log_vcenter_activity(
    operation="property_collector_fetch",
    endpoint=f"{vcenter_name} - PropertyCollector",
    success=True,
    response_time_ms=int(fetch_time * 1000),
    details={
        "vms": len(inventory.get('vms', [])),
        "hosts": len(inventory.get('hosts', [])),
        "datastores": len(inventory.get('datastores', [])),
        "networks": len(inventory.get('networks', [])),
        "clusters": len(inventory.get('clusters', [])),
        "dvportgroups": len(inventory.get('dvportgroups', [])),
    },
    job_id=job_id
)
```

---

## 7. Feature Flag for Rollback

Add environment variable to toggle between old and new sync:

```python
# In job_executor/config.py
USE_PROPERTY_COLLECTOR_SYNC = os.getenv('USE_PROPERTY_COLLECTOR_SYNC', 'true').lower() == 'true'
```

```python
# In vcenter_handlers.py (temporary during migration)
from job_executor.config import USE_PROPERTY_COLLECTOR_SYNC

if USE_PROPERTY_COLLECTOR_SYNC:
    # New fast path
    fast_result = self.executor.sync_vcenter_fast(...)
    alarms_result = self.executor.sync_vcenter_alarms(...)
else:
    # Legacy sequential sync (REMOVE after validation)
    clusters_result = self.executor.sync_vcenter_clusters(...)
    datastores_result = self.executor.sync_vcenter_datastores(...)
    networks_result = self.executor.sync_vcenter_networks(...)
    vms_result = self.executor.sync_vcenter_vms(...)
    alarms_result = self.executor.sync_vcenter_alarms(...)
    hosts_result = self.executor.sync_vcenter_hosts(...)
```

**Note:** The legacy path should only exist during initial testing. Once validated, remove the old methods entirely.

---

## 8. Implementation Checklist

### Phase 1: Documentation
- [x] Create `docs/vmware_sync_remaster_1.md` with this plan

### Phase 2: PropertyCollector Module
- [ ] Create `job_executor/mixins/vcenter_property_collector.py`
- [ ] Implement `collect_vcenter_inventory(content)`
- [ ] Implement `_build_property_specs()` for all 7 object types
- [ ] Implement `_build_traversal_spec(view_ref)`
- [ ] Implement `_parse_object_content(obj_content)`
- [ ] Handle pagination with `ContinueRetrievePropertiesEx`
- [ ] Add comprehensive error handling
- [ ] Add debug logging

### Phase 3: VCenter Ops Integration
- [ ] Add `sync_vcenter_fast()` to `VCenterMixin` in `vcenter_ops.py`
- [ ] Implement `_build_moref_lookups()` helper
- [ ] Implement `_process_clusters()`, `_process_hosts()`, etc.
- [ ] Reuse existing `_upsert_vm_batch()` and similar methods
- [ ] Add performance timing and logging
- [ ] Add `USE_PROPERTY_COLLECTOR_SYNC` to `config.py`

### Phase 4: Handler Update
- [ ] Update `_sync_single_vcenter()` in `vcenter_handlers.py`
- [ ] Update phase definitions (7 → 3)
- [ ] Implement feature flag toggle (temporary)
- [ ] Update progress reporting
- [ ] Update result aggregation

### Phase 5: Remove Old Code
- [ ] Remove `sync_vcenter_clusters()` from `vcenter_ops.py`
- [ ] Remove `sync_vcenter_vms()` from `vcenter_ops.py`
- [ ] Remove `sync_vcenter_datastores()` from `vcenter_ops.py`
- [ ] Remove `sync_vcenter_networks()` from `vcenter_ops.py`
- [ ] Remove `sync_vcenter_hosts()` from `vcenter_ops.py`
- [ ] Remove feature flag toggle from handler
- [ ] Update `job-executor.py` comments

### Phase 6: Testing & Verification
- [ ] Test with small vCenter (< 100 VMs)
- [ ] Test with large vCenter (1500+ VMs)
- [ ] Verify all data synced correctly (compare row counts)
- [ ] Compare sync times (before/after)
- [ ] Test job cancellation still works
- [ ] Test error handling (connection loss, timeouts)
- [ ] Verify auto-linking still works (serial numbers)
- [ ] Verify datastore-host relationships
- [ ] Verify network VLAN information

---

## 9. Expected Outcomes

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| ContainerViews created | 6-8 | 1 | 85% reduction |
| SOAP calls | ~25,000+ | 2-5 | 99.98% reduction |
| Sync time (1500 VMs) | 3-5 minutes | 15-30 seconds | 90% faster |
| Code lines (sync methods) | ~876 | ~200 | 77% reduction |
| Progress phases | 7 | 3 | Simplified UX |

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PropertyCollector returns different data format | Data mismatch | Extensive property mapping tests |
| Some properties unavailable via PropertyCollector | Missing data | Fallback to individual fetch if needed |
| Large result sets cause memory issues | OOM errors | Pagination handles this automatically |
| Network timeout on large fetch | Sync failure | Add timeout handling, retry logic |
| Breaking existing functionality | Data loss | Feature flag for instant rollback |
| MoRef resolution failures | Missing relationships | Build comprehensive lookup maps first |

---

## 11. References

- [VMware vSphere API Reference - PropertyCollector](https://developer.vmware.com/apis/1355/)
- [pyvmomi PropertyCollector samples](https://github.com/vmware/pyvmomi-community-samples/tree/master/samples)
- [Dell iDRAC-Redfish-Scripting](https://github.com/dell/iDRAC-Redfish-Scripting) (for Dell API patterns)
- Current implementation: `job_executor/mixins/vcenter_ops.py`
- Handler: `job_executor/handlers/vcenter_handlers.py`
