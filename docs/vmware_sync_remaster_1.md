# vCenter PropertyCollector-Based Inventory Sync Plan

This document defines the full design for a high‑performance vCenter inventory synchronization system using the VMware vSphere Python SDK (pyVmomi) and the PropertyCollector API.  
The plan is explicitly structured for LLMs: all object shapes, return formats, required fields, helper behaviors, and traversal rules are unambiguous and non‑negotiable.

---

# 1. Overview

The system replaces slow, iterative inventory crawling with a **single batched PropertyCollector operation**.  
It retrieves Virtual Machines, Hosts, Clusters, Datastores, Networks, DVPGs, and DVSes efficiently and returns fully processed, JSON‑serializable data for database upsertion.

Two stages exist:

## Stage A — `collect_vcenter_inventory()`

Returns RAW inventory directly from PropertyCollector:

```
{
  "clusters": List[Tuple[vim.ClusterComputeResource, Dict[str, Any]]],
  "hosts": List[Tuple[vim.HostSystem, Dict[str, Any]]],
  "vms": List[Tuple[vim.VirtualMachine, Dict[str, Any]]],
  "datastores": List[Tuple[vim.Datastore, Dict[str, Any]]],
  "networks": List[Tuple[vim.Network, Dict[str, Any]]],
  "dvpgs": List[Tuple[vim.dvs.DistributedVirtualPortgroup, Dict[str, Any]]],
  "dvswitches": List[Tuple[vim.DistributedVirtualSwitch, Dict[str, Any]]],
  "errors": List[ErrorDict],
  "fetch_time_ms": int
}
```

## Stage B — `sync_vcenter_fast()`

Processes raw inventory into JSON‑serializable dicts and returns:

```
{
  "clusters": [...],
  "hosts": [...],
  "vms": [...],
  "datastores": [...],
  "networks": [...],
  "dvpgs": [...],
  "dvswitches": [...],
  "fetch_time_ms": int,
  "process_time_ms": int,
  "total_objects": int,
  "errors": [...]
}
```

---

# 2. ContainerView & Traversal

A **single ContainerView** must be created containing:

- vim.VirtualMachine
- vim.HostSystem
- vim.ClusterComputeResource
- vim.Datastore
- vim.Network
- vim.dvs.DistributedVirtualPortgroup
- vim.DistributedVirtualSwitch

### TraversalSpec (MANDATORY)

```
TraversalSpec(
  name="viewTraversal",
  type=vim.view.ContainerView,
  path="view",
  skip=False
)
```

Do _not_ infer type dynamically.

---

# 3. PropertySpec Requirements

Each object type must request only the properties listed below.

## VM Properties

- name
- config.uuid
- runtime.powerState
- summary.config.vmPathName
- summary.runtime.host (MoRef)
- summary.runtime.connectionState

## Host Properties

- name
- hardware.systemInfo.serialNumber
- hardware.cpuInfo
- hardware.memorySize
- summary.runtime.powerState
- summary.runtime.connectionState
- parent (Cluster MoRef)

## Cluster Properties

- name
- summary.numHosts
- summary.numEffectiveHosts
- summary.totalCpu
- summary.totalMemory

## Datastore Properties

- name
- summary.capacity
- summary.freeSpace
- summary.type

### Optional heavy properties (deep relationships)

Controlled by:

```
ENABLE_DEEP_RELATIONSHIPS = false
```

Optional fields (only included if enabled):

- datastore.host
- datastore.vm
- network.host
- network.vm
- dvportgroup.host
- dvportgroup.vm

## Network

- name

## DVPG

- name
- parent (DVS MoRef)

## DVS

- name
- uuid

---

# 4. RAW Object Parsing

All PropertyCollector ObjectContent instances MUST be transformed via:

```
(obj, props) where props = { property_name: property_value }
```

### Mandatory `_parse_object_content()` implementation:

```
def _parse_object_content(oc):
    obj = oc.obj
    props = {p.name: p.val for p in (oc.propSet or [])}
    return obj, props
```

LLMs must not modify this data shape.

---

# 5. MoRef Extraction & Lookups

Every object’s MoRef MUST be extracted as:

```
moref = str(obj._moId)
```

Lookups required:

```
cluster_moref_to_name
host_moref_to_name
host_moref_to_cluster
dvpg_moref_to_dvs
dvs_moref_to_name
```

These are built from RAW inventory tuples.

---

# 6. Pagination Rules

PropertyCollector calls must obey:

```
options = RetrieveOptions(maxObjects=1000)

result = pc.RetrievePropertiesEx([filter_spec], options)
objects = result.objects or []
token = result.token

while token:
    result = pc.ContinueRetrievePropertiesEx(token)
    objects.extend(result.objects or [])
    token = result.token
```

No deviations allowed.

---

# 7. Error Handling

Errors must not abort the entire sync.  
Handlers must:

- Catch `vmodl.fault.*` and generic Exceptions per-object
- Convert into JSON-safe:

```
{
  "object": "optional-moref-or-type",
  "message": str(error),
  "severity": "warning" | "error"
}
```

Return list under `"errors"`.

---

# 8. Final Output Requirements

### `sync_vcenter_fast()` MUST return exactly:

```
{
  "clusters": [ {"id": ..., "name": ..., ...}, ...],
  "hosts": [ {"id": ..., "name": ..., "cluster": ..., ...}, ...],
  "vms": [...],
  "datastores": [...],
  "networks": [...],
  "dvpgs": [...],
  "dvswitches": [...],
  "fetch_time_ms": int,
  "process_time_ms": int,
  "total_objects": int,
  "errors": [...]
}
```

All values must be **JSON‑serializable**.  
No vim objects may appear in the return dict.

---

# 9. Feature Flag Migration

```
USE_PROPERTY_COLLECTOR_SYNC = True
```

If False:

- fallback to legacy slow inventory method
- keep old code untouched

---

# 10. Summary

This rewritten plan ensures:

- Only one batched vCenter inventory sync call
- Predictable and safe LLM code generation
- Reduces 1000+ API calls to a single paginated retrieval
- Clean, deterministic output for database ingestion

THIS DOCUMENT DEFINES THE CONTRACT.  
LLMs implementing this must follow the exact shapes and rules above.
