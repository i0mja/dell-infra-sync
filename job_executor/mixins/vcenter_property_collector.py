"""
vCenter PropertyCollector-Based Inventory Sync Module

This module implements high-performance vCenter inventory synchronization using
the VMware vSphere PropertyCollector API. It replaces slow iterative crawling
with a single batched operation.

Contract defined in: docs/vmware_sync_remaster_1.md
"""

import time
import logging
from typing import Dict, List, Tuple, Any, Optional

from pyVmomi import vim, vmodl

from job_executor.config import ENABLE_DEEP_RELATIONSHIPS

logger = logging.getLogger(__name__)


# =============================================================================
# Property Specifications (Exact as defined in spec)
# =============================================================================

def _get_vm_properties() -> List[str]:
    """VM properties - Required set from spec."""
    return [
        "name",
        "config.uuid",
        "runtime.powerState",
        "summary.config.vmPathName",
        "summary.runtime.host",
        "summary.runtime.connectionState",
    ]


def _get_host_properties() -> List[str]:
    """Host properties - Required set from spec."""
    return [
        "name",
        "hardware.systemInfo.serialNumber",
        "hardware.cpuInfo",
        "hardware.memorySize",
        "summary.runtime.powerState",
        "summary.runtime.connectionState",
        "summary.quickStats",  # Phase 2: CPU/memory usage metrics
        "parent",
    ]


def _get_cluster_properties() -> List[str]:
    """Cluster properties - Required set from spec."""
    return [
        "name",
        "summary.numHosts",
        "summary.numEffectiveHosts",
        "summary.totalCpu",
        "summary.totalMemory",
        "datastore",  # Phase 2: List[vim.Datastore] for cluster_moref_to_datastores
    ]


def _get_datastore_properties(enable_deep: bool = False) -> List[str]:
    """Datastore properties - Required + optional deep relationships."""
    props = [
        "name",
        "summary.capacity",
        "summary.freeSpace",
        "summary.type",
    ]
    if enable_deep:
        props.extend(["host", "vm"])
    return props


def _get_network_properties(enable_deep: bool = False) -> List[str]:
    """Network properties - Required + optional deep relationships."""
    props = ["name"]
    if enable_deep:
        props.extend(["host", "vm"])
    return props


def _get_dvpg_properties(enable_deep: bool = False) -> List[str]:
    """DVPG properties - Required + optional deep relationships."""
    props = ["name", "parent"]
    if enable_deep:
        props.extend(["host", "vm"])
    return props


def _get_dvs_properties() -> List[str]:
    """DVS properties - Required set from spec."""
    return ["name", "uuid"]


# =============================================================================
# Core Helper Functions (Mandatory implementations from spec)
# =============================================================================

def _parse_object_content(oc) -> Tuple[Any, Dict[str, Any]]:
    """
    Parse PropertyCollector ObjectContent into (obj, props) tuple.
    
    This is the MANDATORY implementation from the spec - DO NOT MODIFY.
    
    Args:
        oc: vim.PropertyCollector.ObjectContent
        
    Returns:
        Tuple of (vim_object, {property_name: property_value})
    """
    obj = oc.obj
    props = {p.name: p.val for p in (oc.propSet or [])}
    return obj, props


def _build_property_specs(enable_deep: bool = False) -> List[vim.PropertyCollector.PropertySpec]:
    """
    Build PropertySpec list for all 7 object types.
    
    Args:
        enable_deep: If True, include heavy relationship properties
        
    Returns:
        List of vim.PropertyCollector.PropertySpec
    """
    specs = []
    
    # VM
    specs.append(vim.PropertyCollector.PropertySpec(
        type=vim.VirtualMachine,
        pathSet=_get_vm_properties(),
        all=False
    ))
    
    # Host
    specs.append(vim.PropertyCollector.PropertySpec(
        type=vim.HostSystem,
        pathSet=_get_host_properties(),
        all=False
    ))
    
    # Cluster
    specs.append(vim.PropertyCollector.PropertySpec(
        type=vim.ClusterComputeResource,
        pathSet=_get_cluster_properties(),
        all=False
    ))
    
    # Datastore
    specs.append(vim.PropertyCollector.PropertySpec(
        type=vim.Datastore,
        pathSet=_get_datastore_properties(enable_deep),
        all=False
    ))
    
    # Network
    specs.append(vim.PropertyCollector.PropertySpec(
        type=vim.Network,
        pathSet=_get_network_properties(enable_deep),
        all=False
    ))
    
    # DVPG
    specs.append(vim.PropertyCollector.PropertySpec(
        type=vim.dvs.DistributedVirtualPortgroup,
        pathSet=_get_dvpg_properties(enable_deep),
        all=False
    ))
    
    # DVS
    specs.append(vim.PropertyCollector.PropertySpec(
        type=vim.DistributedVirtualSwitch,
        pathSet=_get_dvs_properties(),
        all=False
    ))
    
    return specs


def _build_traversal_spec() -> vim.PropertyCollector.TraversalSpec:
    """
    Build TraversalSpec for ContainerView traversal.
    
    CRITICAL: type MUST be vim.view.ContainerView (explicit, never dynamic).
    
    Returns:
        vim.PropertyCollector.TraversalSpec
    """
    return vim.PropertyCollector.TraversalSpec(
        name="viewTraversal",
        type=vim.view.ContainerView,
        path="view",
        skip=False
    )


# =============================================================================
# Stage A: collect_vcenter_inventory() - RAW Inventory Collection
# =============================================================================

def collect_vcenter_inventory(
    content,
    enable_deep: bool = None
) -> Dict[str, Any]:
    """
    Stage A: Collect RAW inventory from vCenter using PropertyCollector.
    
    Returns inventory with tuples: (vim_object, properties_dict)
    
    Args:
        content: vim.ServiceContent from si.RetrieveContent()
        enable_deep: Override ENABLE_DEEP_RELATIONSHIPS flag
        
    Returns:
        {
            "clusters": List[Tuple[vim.ClusterComputeResource, Dict]],
            "hosts": List[Tuple[vim.HostSystem, Dict]],
            "vms": List[Tuple[vim.VirtualMachine, Dict]],
            "datastores": List[Tuple[vim.Datastore, Dict]],
            "networks": List[Tuple[vim.Network, Dict]],
            "dvpgs": List[Tuple[vim.dvs.DistributedVirtualPortgroup, Dict]],
            "dvswitches": List[Tuple[vim.DistributedVirtualSwitch, Dict]],
            "errors": List[ErrorDict],
            "fetch_time_ms": int
        }
    """
    if enable_deep is None:
        enable_deep = ENABLE_DEEP_RELATIONSHIPS
    
    start_time = time.time()
    errors = []
    
    # Initialize result containers
    clusters = []
    hosts = []
    vms = []
    datastores = []
    networks = []
    dvpgs = []
    dvswitches = []
    
    view_ref = None
    
    try:
        # Create single ContainerView for all 7 object types
        view_ref = content.viewManager.CreateContainerView(
            container=content.rootFolder,
            type=[
                vim.VirtualMachine,
                vim.HostSystem,
                vim.ClusterComputeResource,
                vim.Datastore,
                vim.Network,
                vim.dvs.DistributedVirtualPortgroup,
                vim.DistributedVirtualSwitch,
            ],
            recursive=True
        )
        
        # Build PropertyCollector filter
        traversal_spec = _build_traversal_spec()
        
        obj_spec = vim.PropertyCollector.ObjectSpec(
            obj=view_ref,
            selectSet=[traversal_spec],
            skip=False
        )
        
        property_specs = _build_property_specs(enable_deep)
        
        filter_spec = vim.PropertyCollector.FilterSpec(
            objectSet=[obj_spec],
            propSet=property_specs
        )
        
        # Execute with MANDATORY pagination
        pc = content.propertyCollector
        options = vim.PropertyCollector.RetrieveOptions(maxObjects=1000)
        
        result = pc.RetrievePropertiesEx(specSet=[filter_spec], options=options)
        
        objects = result.objects or []
        token = result.token
        
        # MANDATORY: Handle pagination token
        while token:
            result = pc.ContinueRetrievePropertiesEx(token)
            objects.extend(result.objects or [])
            token = result.token
        
        logger.info(f"PropertyCollector fetched {len(objects)} objects")
        
        # Parse and categorize objects
        for obj_content in objects:
            try:
                obj, props = _parse_object_content(obj_content)
                
                if isinstance(obj, vim.VirtualMachine):
                    vms.append((obj, props))
                elif isinstance(obj, vim.HostSystem):
                    hosts.append((obj, props))
                elif isinstance(obj, vim.ClusterComputeResource):
                    clusters.append((obj, props))
                elif isinstance(obj, vim.Datastore):
                    datastores.append((obj, props))
                elif isinstance(obj, vim.dvs.DistributedVirtualPortgroup):
                    dvpgs.append((obj, props))
                elif isinstance(obj, vim.DistributedVirtualSwitch):
                    dvswitches.append((obj, props))
                elif isinstance(obj, vim.Network):
                    networks.append((obj, props))
                    
            except vmodl.fault.ManagedObjectNotFound:
                errors.append({
                    "object": str(obj_content.obj) if obj_content else "unknown",
                    "message": "Object was deleted during fetch",
                    "severity": "warning"
                })
            except Exception as e:
                errors.append({
                    "object": str(obj_content.obj) if obj_content else "unknown",
                    "message": str(e),
                    "severity": "error"
                })
                logger.warning(f"Error parsing object: {e}")
                
    except Exception as e:
        errors.append({
            "object": "PropertyCollector",
            "message": f"Fatal collection error: {str(e)}",
            "severity": "error"
        })
        logger.error(f"PropertyCollector error: {e}")
        
    finally:
        # Cleanup ContainerView
        if view_ref:
            try:
                view_ref.Destroy()
            except Exception:
                pass
    
    fetch_time_ms = int((time.time() - start_time) * 1000)
    
    return {
        "clusters": clusters,
        "hosts": hosts,
        "vms": vms,
        "datastores": datastores,
        "networks": networks,
        "dvpgs": dvpgs,
        "dvswitches": dvswitches,
        "errors": errors,
        "fetch_time_ms": fetch_time_ms,
    }


# =============================================================================
# MoRef Lookup Maps (Required from spec)
# =============================================================================

def _build_moref_lookups(inventory: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build MoRef-keyed lookup maps for relationship resolution.
    
    Phase 2 lookups:
        - host_moref_to_cluster: MoRef -> cluster MoRef string
        - host_moref_to_cluster_name: MoRef -> cluster name string
        - cluster_moref_to_datastores: MoRef -> List[datastore MoRef strings]
        - datastore_moref_to_summary: MoRef -> {capacity, freeSpace, type}
        - host_moref_to_quickstats: MoRef -> {overallCpuUsage, overallMemoryUsage, ...}
        - cluster_moref_to_vm_count: MoRef -> int (count of VMs in cluster)
        
    Existing lookups (preserved):
        - cluster_moref_to_name
        - host_moref_to_name
        - dvpg_moref_to_dvs
        - dvs_moref_to_name
        
    Args:
        inventory: RAW inventory from collect_vcenter_inventory()
        
    Returns:
        Dict containing all lookup maps
    """
    # Initialize all lookup dictionaries
    cluster_moref_to_name = {}
    host_moref_to_name = {}
    host_moref_to_cluster = {}         # Phase 2: MoRef -> cluster MoRef
    host_moref_to_cluster_name = {}    # Phase 2: MoRef -> cluster name
    cluster_moref_to_datastores = {}   # Phase 2: MoRef -> List[datastore MoRefs]
    datastore_moref_to_summary = {}    # Phase 2: MoRef -> summary dict
    host_moref_to_quickstats = {}      # Phase 2: MoRef -> quickStats dict
    cluster_moref_to_vm_count = {}     # Phase 2: MoRef -> VM count
    dvpg_moref_to_dvs = {}
    dvs_moref_to_name = {}
    
    # 1. Build cluster lookups first (needed for host resolution)
    for obj, props in inventory["clusters"]:
        moref = str(obj._moId)
        cluster_moref_to_name[moref] = props.get("name", "")
        cluster_moref_to_vm_count[moref] = 0  # Initialize, will count VMs later
        
        # Extract cluster datastores
        datastores = props.get("datastore", [])
        ds_morefs = []
        if datastores:
            for ds in datastores:
                if hasattr(ds, "_moId"):
                    ds_morefs.append(str(ds._moId))
        cluster_moref_to_datastores[moref] = ds_morefs
    
    # 2. Build datastore summary lookups
    for obj, props in inventory["datastores"]:
        moref = str(obj._moId)
        datastore_moref_to_summary[moref] = {
            "capacity": props.get("summary.capacity", 0),
            "freeSpace": props.get("summary.freeSpace", 0),
            "type": props.get("summary.type", ""),
        }
    
    # 3. Build DVS map (needed for DVPG resolution)
    for obj, props in inventory["dvswitches"]:
        moref = str(obj._moId)
        dvs_moref_to_name[moref] = props.get("name", "")
    
    # 4. Build host lookups
    for obj, props in inventory["hosts"]:
        moref = str(obj._moId)
        host_moref_to_name[moref] = props.get("name", "")
        
        # Resolve parent cluster (MoRef and name)
        parent = props.get("parent")
        if parent and hasattr(parent, "_moId"):
            cluster_moref = str(parent._moId)
            host_moref_to_cluster[moref] = cluster_moref
            host_moref_to_cluster_name[moref] = cluster_moref_to_name.get(cluster_moref, "")
        
        # Extract quickStats
        quick_stats = props.get("summary.quickStats")
        if quick_stats:
            host_moref_to_quickstats[moref] = {
                "overallCpuUsage": getattr(quick_stats, "overallCpuUsage", 0),
                "overallMemoryUsage": getattr(quick_stats, "overallMemoryUsage", 0),
                "distributedCpuFairness": getattr(quick_stats, "distributedCpuFairness", None),
                "distributedMemoryFairness": getattr(quick_stats, "distributedMemoryFairness", None),
                "uptime": getattr(quick_stats, "uptime", 0),
            }
    
    # 5. Build DVPG to DVS map
    for obj, props in inventory["dvpgs"]:
        moref = str(obj._moId)
        parent = props.get("parent")
        if parent and hasattr(parent, "_moId"):
            dvs_moref = str(parent._moId)
            dvpg_moref_to_dvs[moref] = dvs_moref_to_name.get(dvs_moref, "")
    
    # 6. Count VMs per cluster
    for obj, props in inventory["vms"]:
        host_ref = props.get("summary.runtime.host")
        if host_ref and hasattr(host_ref, "_moId"):
            host_moref = str(host_ref._moId)
            cluster_moref = host_moref_to_cluster.get(host_moref)
            if cluster_moref and cluster_moref in cluster_moref_to_vm_count:
                cluster_moref_to_vm_count[cluster_moref] += 1
    
    return {
        # Existing lookups
        "cluster_moref_to_name": cluster_moref_to_name,
        "host_moref_to_name": host_moref_to_name,
        "dvpg_moref_to_dvs": dvpg_moref_to_dvs,
        "dvs_moref_to_name": dvs_moref_to_name,
        # Phase 2 lookups
        "host_moref_to_cluster": host_moref_to_cluster,
        "host_moref_to_cluster_name": host_moref_to_cluster_name,
        "cluster_moref_to_datastores": cluster_moref_to_datastores,
        "datastore_moref_to_summary": datastore_moref_to_summary,
        "host_moref_to_quickstats": host_moref_to_quickstats,
        "cluster_moref_to_vm_count": cluster_moref_to_vm_count,
    }


# =============================================================================
# Stage B: sync_vcenter_fast() - JSON-Serializable Output
# =============================================================================

def _process_cluster(obj, props: Dict) -> Dict[str, Any]:
    """Transform cluster to JSON-serializable dict."""
    return {
        "id": str(obj._moId),
        "name": props.get("name", ""),
        "num_hosts": props.get("summary.numHosts", 0),
        "num_effective_hosts": props.get("summary.numEffectiveHosts", 0),
        "total_cpu": props.get("summary.totalCpu", 0),
        "total_memory": props.get("summary.totalMemory", 0),
    }


def _process_host(obj, props: Dict, lookups: Dict) -> Dict[str, Any]:
    """Transform host to JSON-serializable dict."""
    moref = str(obj._moId)
    return {
        "id": moref,
        "name": props.get("name", ""),
        "serial_number": props.get("hardware.systemInfo.serialNumber", ""),
        "cluster": lookups["host_moref_to_cluster"].get(moref, ""),
        "power_state": str(props.get("summary.runtime.powerState", "")),
        "connection_state": str(props.get("summary.runtime.connectionState", "")),
        "cpu_info": _safe_cpu_info(props.get("hardware.cpuInfo")),
        "memory_size": props.get("hardware.memorySize", 0),
    }


def _safe_cpu_info(cpu_info) -> Dict[str, Any]:
    """Extract CPU info safely."""
    if not cpu_info:
        return {}
    try:
        return {
            "num_cpu_packages": getattr(cpu_info, "numCpuPackages", 0),
            "num_cpu_cores": getattr(cpu_info, "numCpuCores", 0),
            "num_cpu_threads": getattr(cpu_info, "numCpuThreads", 0),
            "hz": getattr(cpu_info, "hz", 0),
        }
    except Exception:
        return {}


def _process_vm(obj, props: Dict, lookups: Dict) -> Dict[str, Any]:
    """Transform VM to JSON-serializable dict."""
    host_ref = props.get("summary.runtime.host")
    host_name = ""
    if host_ref and hasattr(host_ref, "_moId"):
        host_name = lookups["host_moref_to_name"].get(str(host_ref._moId), "")
    
    return {
        "id": str(obj._moId),
        "name": props.get("name", ""),
        "uuid": props.get("config.uuid", ""),
        "power_state": str(props.get("runtime.powerState", "")),
        "vm_path_name": props.get("summary.config.vmPathName", ""),
        "host": host_name,
        "connection_state": str(props.get("summary.runtime.connectionState", "")),
    }


def _process_datastore(obj, props: Dict) -> Dict[str, Any]:
    """Transform datastore to JSON-serializable dict."""
    return {
        "id": str(obj._moId),
        "name": props.get("name", ""),
        "capacity": props.get("summary.capacity", 0),
        "free_space": props.get("summary.freeSpace", 0),
        "type": props.get("summary.type", ""),
    }


def _process_network(obj, props: Dict) -> Dict[str, Any]:
    """Transform network to JSON-serializable dict."""
    return {
        "id": str(obj._moId),
        "name": props.get("name", ""),
    }


def _process_dvpg(obj, props: Dict, lookups: Dict) -> Dict[str, Any]:
    """Transform DVPG to JSON-serializable dict."""
    moref = str(obj._moId)
    return {
        "id": moref,
        "name": props.get("name", ""),
        "dvs_name": lookups["dvpg_moref_to_dvs"].get(moref, ""),
    }


def _process_dvswitch(obj, props: Dict) -> Dict[str, Any]:
    """Transform DVSwitch to JSON-serializable dict."""
    return {
        "id": str(obj._moId),
        "name": props.get("name", ""),
        "uuid": props.get("uuid", ""),
    }


def sync_vcenter_fast(
    content,
    source_vcenter_id: Optional[str] = None,
    enable_deep: bool = None
) -> Dict[str, Any]:
    """
    Stage B: Full inventory sync returning JSON-serializable output.
    
    This function calls collect_vcenter_inventory() and transforms the
    RAW inventory into JSON-safe dictionaries for database ingestion.
    
    Args:
        content: vim.ServiceContent from si.RetrieveContent()
        source_vcenter_id: Optional vCenter ID for tracking
        enable_deep: Override ENABLE_DEEP_RELATIONSHIPS flag
        
    Returns:
        {
            "clusters": [{"id": ..., "name": ...}, ...],
            "hosts": [{"id": ..., "name": ..., "cluster": ...}, ...],
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
        
    All values are JSON-serializable. No vim objects in return dict.
    """
    # Stage A: Collect RAW inventory
    inventory = collect_vcenter_inventory(content, enable_deep)
    
    process_start = time.time()
    errors = list(inventory["errors"])
    
    # Build lookup maps for relationship resolution
    lookups = _build_moref_lookups(inventory)
    
    # Transform to JSON-serializable output
    clusters = []
    hosts = []
    vms = []
    datastores = []
    networks = []
    dvpgs = []
    dvswitches = []
    
    # Process clusters
    for obj, props in inventory["clusters"]:
        try:
            clusters.append(_process_cluster(obj, props))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"Cluster processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process hosts
    for obj, props in inventory["hosts"]:
        try:
            hosts.append(_process_host(obj, props, lookups))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"Host processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process VMs
    for obj, props in inventory["vms"]:
        try:
            vms.append(_process_vm(obj, props, lookups))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"VM processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process datastores
    for obj, props in inventory["datastores"]:
        try:
            datastores.append(_process_datastore(obj, props))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"Datastore processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process networks
    for obj, props in inventory["networks"]:
        try:
            networks.append(_process_network(obj, props))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"Network processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process DVPGs
    for obj, props in inventory["dvpgs"]:
        try:
            dvpgs.append(_process_dvpg(obj, props, lookups))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"DVPG processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process DVSwitches
    for obj, props in inventory["dvswitches"]:
        try:
            dvswitches.append(_process_dvswitch(obj, props))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"DVSwitch processing error: {str(e)}",
                "severity": "warning"
            })
    
    process_time_ms = int((time.time() - process_start) * 1000)
    
    total_objects = (
        len(clusters) + len(hosts) + len(vms) + 
        len(datastores) + len(networks) + len(dvpgs) + len(dvswitches)
    )
    
    logger.info(
        f"sync_vcenter_fast completed: {total_objects} objects, "
        f"fetch={inventory['fetch_time_ms']}ms, process={process_time_ms}ms"
    )
    
    return {
        "clusters": clusters,
        "hosts": hosts,
        "vms": vms,
        "datastores": datastores,
        "networks": networks,
        "dvpgs": dvpgs,
        "dvswitches": dvswitches,
        "fetch_time_ms": inventory["fetch_time_ms"],
        "process_time_ms": process_time_ms,
        "total_objects": total_objects,
        "errors": errors,
    }
