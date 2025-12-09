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
    """VM properties - Required set from spec + Phase 7 additions."""
    return [
        "name",
        "config.uuid",
        "config.template",                    # Phase 7: Is VM a template?
        "runtime.powerState",
        "summary.config.vmPathName",
        "summary.config.numCpu",              # Phase 7: CPU count
        "summary.config.memorySizeMB",        # Phase 7: Memory in MB
        "summary.config.guestFullName",       # Phase 7: Guest OS name
        "summary.runtime.host",
        "summary.runtime.connectionState",
        "guest.ipAddress",                    # Phase 7: Primary IP
        "guest.toolsStatus",                  # Phase 7: VMware Tools status
        "guest.toolsVersionStatus2",          # Phase 7: VMware Tools version status
        "storage.perDatastoreUsage",          # Phase 7: Disk usage by datastore
    ]


def _get_host_properties() -> List[str]:
    """Host properties - Required set from spec + Phase 7 additions."""
    return [
        "name",
        "hardware.systemInfo.serialNumber",
        "hardware.cpuInfo",
        "hardware.memorySize",
        "summary.runtime.powerState",
        "summary.runtime.connectionState",
        "summary.runtime.inMaintenanceMode",  # Phase 7: Maintenance mode
        "summary.config.product.version",     # Phase 7: ESXi version
        "summary.config.product.build",       # Phase 7: ESXi build
        "summary.quickStats",                 # Phase 2: CPU/memory usage metrics
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
        # Phase 4: HA/DRS configuration
        "configuration.dasConfig",  # HA config (enabled, admissionControlEnabled, etc.)
        "configuration.drsConfig",  # DRS config (enabled, defaultVmBehavior, etc.)
        "overallStatus",            # Cluster health: green/yellow/red/gray
    ]


def _get_datastore_properties(enable_deep: bool = False) -> List[str]:
    """Datastore properties - Required + optional deep relationships."""
    props = [
        "name",
        "summary.capacity",
        "summary.freeSpace",
        "summary.type",
        "summary.accessible",                 # Phase 7: Accessibility
    ]
    if enable_deep:
        props.extend(["host", "vm"])
    return props


def _get_network_properties(enable_deep: bool = False) -> List[str]:
    """Network properties - Required + optional deep relationships."""
    props = [
        "name",
        "summary.accessible",  # Network accessibility
    ]
    if enable_deep:
        props.extend(["host", "vm"])
    return props


def _get_dvpg_properties(enable_deep: bool = False) -> List[str]:
    """DVPG properties - Required + optional deep relationships."""
    props = [
        "name",
        "parent",                              # DVS parent reference
        "config.defaultPortConfig",            # VLAN config container
        "summary.accessible",                  # Accessibility status
    ]
    if enable_deep:
        props.extend(["host", "vm"])
    return props


def _get_dvs_properties() -> List[str]:
    """DVS properties - Required set from spec."""
    return [
        "name",
        "uuid",
        "summary.numPorts",    # Total port count
    ]


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
                type_name = type(obj).__name__
                
                if isinstance(obj, vim.VirtualMachine):
                    vms.append((obj, props))
                elif isinstance(obj, vim.HostSystem):
                    hosts.append((obj, props))
                elif isinstance(obj, vim.ClusterComputeResource):
                    clusters.append((obj, props))
                elif isinstance(obj, vim.Datastore):
                    datastores.append((obj, props))
                # Use type name matching for distributed networking (pyVmomi dynamic types)
                elif isinstance(obj, vim.dvs.DistributedVirtualPortgroup) or 'DistributedVirtualPortgroup' in type_name:
                    dvpgs.append((obj, props))
                    logger.debug(f"Captured DVPG: {props.get('name', 'unknown')} (type: {type_name})")
                elif isinstance(obj, vim.DistributedVirtualSwitch) or 'DistributedVirtualSwitch' in type_name or 'VmwareDistributedVirtualSwitch' in type_name:
                    dvswitches.append((obj, props))
                    logger.debug(f"Captured DVS: {props.get('name', 'unknown')} (type: {type_name})")
                elif isinstance(obj, vim.Network) or type_name == 'Network':
                    networks.append((obj, props))
                    logger.debug(f"Captured Network: {props.get('name', 'unknown')} (type: {type_name})")
                    
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
    
    # 7. Phase 4: Aggregate used CPU/Memory per cluster from host quickstats
    cluster_moref_to_used_resources: Dict[str, Dict[str, int]] = {}
    for cluster_moref in cluster_moref_to_name.keys():
        cluster_moref_to_used_resources[cluster_moref] = {
            "used_cpu_mhz": 0,
            "used_memory_mb": 0,
        }
    
    for host_moref, quickstats in host_moref_to_quickstats.items():
        cluster_moref = host_moref_to_cluster.get(host_moref)
        if cluster_moref and cluster_moref in cluster_moref_to_used_resources:
            cluster_moref_to_used_resources[cluster_moref]["used_cpu_mhz"] += quickstats.get("overallCpuUsage", 0) or 0
            cluster_moref_to_used_resources[cluster_moref]["used_memory_mb"] += quickstats.get("overallMemoryUsage", 0) or 0
    
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
        # Phase 4 lookup
        "cluster_moref_to_used_resources": cluster_moref_to_used_resources,
    }


# =============================================================================
# Stage B: sync_vcenter_fast() - JSON-Serializable Output
# =============================================================================

def _cluster_to_dict(obj, props: Dict[str, Any], lookups: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform cluster to JSON-serializable dict with computed metrics.
    
    Phase 4 implementation per docs/vcenter_sync_final_plan.md:
    - Computes total/used CPU, memory, storage from lookups
    - Extracts HA/DRS config
    - All values JSON-safe
    
    Args:
        obj: vim.ClusterComputeResource object
        props: Dict of properties from PropertyCollector
        lookups: Dict of MoRef lookup maps
        
    Returns:
        Dict with cluster fields for database upsert
    """
    moref = str(obj._moId)
    
    # Get used resources from aggregated host quickstats (Phase 4 lookup)
    used_resources = lookups.get("cluster_moref_to_used_resources", {}).get(moref, {})
    used_cpu_mhz = used_resources.get("used_cpu_mhz", 0)
    used_memory_mb = used_resources.get("used_memory_mb", 0)
    
    # Compute storage totals from cluster's datastores
    total_storage_bytes = 0
    used_storage_bytes = 0
    datastore_morefs = lookups.get("cluster_moref_to_datastores", {}).get(moref, [])
    datastore_summaries = lookups.get("datastore_moref_to_summary", {})
    
    for ds_moref in datastore_morefs:
        ds_summary = datastore_summaries.get(ds_moref, {})
        capacity = ds_summary.get("capacity", 0) or 0
        free_space = ds_summary.get("freeSpace", 0) or 0
        total_storage_bytes += capacity
        used_storage_bytes += (capacity - free_space)
    
    # Get VM count from lookup
    vm_count = lookups.get("cluster_moref_to_vm_count", {}).get(moref, 0)
    
    # Extract HA config (dasConfig = Data Availability Services)
    das_config = props.get("configuration.dasConfig")
    ha_enabled = False
    if das_config:
        ha_enabled = getattr(das_config, "enabled", False) or False
    
    # Extract DRS config
    drs_config = props.get("configuration.drsConfig")
    drs_enabled = False
    drs_automation_level = ""
    if drs_config:
        drs_enabled = getattr(drs_config, "enabled", False) or False
        vm_behavior = getattr(drs_config, "defaultVmBehavior", None)
        if vm_behavior is not None:
            drs_automation_level = str(vm_behavior)
    
    # Extract overall status (convert vim enum to string)
    overall_status = props.get("overallStatus")
    if overall_status is not None:
        overall_status = str(overall_status)
    else:
        overall_status = ""
    
    return {
        # Core identifiers
        "id": moref,
        "name": props.get("name", ""),
        
        # Host counts
        "num_hosts": props.get("summary.numHosts", 0) or 0,
        "num_effective_hosts": props.get("summary.numEffectiveHosts", 0) or 0,
        
        # CPU metrics (MHz)
        "total_cpu_mhz": props.get("summary.totalCpu", 0) or 0,
        "used_cpu_mhz": used_cpu_mhz,
        
        # Memory metrics
        "total_memory_bytes": props.get("summary.totalMemory", 0) or 0,
        "used_memory_bytes": used_memory_mb * 1024 * 1024,  # Convert MB to bytes
        
        # Storage metrics (bytes)
        "total_storage_bytes": total_storage_bytes,
        "used_storage_bytes": used_storage_bytes,
        
        # VM count
        "vm_count": vm_count,
        
        # HA/DRS configuration
        "ha_enabled": ha_enabled,
        "drs_enabled": drs_enabled,
        "drs_automation_level": drs_automation_level,
        
        # Status
        "overall_status": overall_status,
    }


def _host_to_dict(obj, props: Dict, lookups: Dict) -> Dict[str, Any]:
    """
    Transform host to JSON-serializable dict with full metrics.
    
    Phase 6+7 implementation - includes quickstats + ESXi version + maintenance mode.
    
    Args:
        obj: vim.HostSystem object
        props: Dict of properties from PropertyCollector
        lookups: Dict of MoRef lookup maps
        
    Returns:
        Dict with host fields for database upsert
    """
    moref = str(obj._moId)
    
    # Get quickstats for this host
    quickstats = lookups.get("host_moref_to_quickstats", {}).get(moref, {})
    
    # Phase 7: ESXi version string
    esxi_version = props.get("summary.config.product.version", "") or ""
    esxi_build = props.get("summary.config.product.build", "") or ""
    if esxi_version and esxi_build:
        esxi_version_full = f"{esxi_version} (Build {esxi_build})"
    else:
        esxi_version_full = esxi_version
    
    # Phase 7: Maintenance mode
    maintenance_mode = props.get("summary.runtime.inMaintenanceMode", False) or False
    
    # Connection state as status
    connection_state = str(props.get("summary.runtime.connectionState", ""))
    
    return {
        "id": moref,
        "name": props.get("name", ""),
        "serial_number": props.get("hardware.systemInfo.serialNumber", ""),
        "cluster_name": lookups.get("host_moref_to_cluster_name", {}).get(moref, ""),
        "cluster_moref": lookups.get("host_moref_to_cluster", {}).get(moref, ""),
        "power_state": str(props.get("summary.runtime.powerState", "")),
        "connection_state": connection_state,
        "status": connection_state,                      # Phase 7: Status = connection state
        "cpu_info": _safe_cpu_info(props.get("hardware.cpuInfo")),
        "memory_size": props.get("hardware.memorySize", 0),
        # Quickstats metrics
        "cpu_usage_mhz": quickstats.get("overallCpuUsage", 0) or 0,
        "memory_usage_mb": quickstats.get("overallMemoryUsage", 0) or 0,
        "uptime_seconds": quickstats.get("uptime", 0) or 0,
        # Phase 7: ESXi version and maintenance mode
        "esxi_version": esxi_version_full,
        "maintenance_mode": maintenance_mode,
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


def _vm_to_dict(obj, props: Dict[str, Any], lookups: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform VM to JSON-serializable dict with cluster resolution.
    
    Phase 3+7 implementation per docs/vcenter_sync_final_plan.md:
    - All fields JSON-safe (no vim objects)
    - Cluster resolved via host->cluster lookup chain
    - Phase 7: CPU, memory, disk, IP, guest OS, tools info
    
    Args:
        obj: vim.VirtualMachine object
        props: Dict of properties from PropertyCollector
        lookups: Dict of MoRef lookup maps from Phase 2
        
    Returns:
        Dict with VM fields for database upsert
    """
    moref = str(obj._moId)
    
    # Resolve host MoRef and name
    host_ref = props.get("summary.runtime.host")
    host_moref = ""
    host_name = ""
    cluster_name = ""
    
    if host_ref and hasattr(host_ref, "_moId"):
        host_moref = str(host_ref._moId)
        host_name = lookups.get("host_moref_to_name", {}).get(host_moref, "")
        # Resolve cluster via host->cluster lookup (Phase 2)
        cluster_name = lookups.get("host_moref_to_cluster_name", {}).get(host_moref, "")
    
    # Extract power state safely (convert vim enum to string)
    power_state = props.get("runtime.powerState")
    if power_state is not None:
        power_state = str(power_state)
    else:
        power_state = ""
    
    # Extract connection state safely
    connection_state = props.get("summary.runtime.connectionState")
    if connection_state is not None:
        connection_state = str(connection_state)
    else:
        connection_state = ""
    
    # Phase 7: Extract guest info
    guest_os = props.get("summary.config.guestFullName", "") or ""
    cpu_count = props.get("summary.config.numCpu", 0) or 0
    memory_mb = props.get("summary.config.memorySizeMB", 0) or 0
    ip_address = props.get("guest.ipAddress", "") or ""
    is_template = props.get("config.template", False) or False
    
    # Phase 7: Tools status
    tools_status = props.get("guest.toolsStatus")
    if tools_status is not None:
        tools_status = str(tools_status)
    else:
        tools_status = ""
    
    # Phase 7: Tools version status
    tools_version = props.get("guest.toolsVersionStatus2")
    if tools_version is not None:
        tools_version = str(tools_version)
    else:
        tools_version = ""
    
    # Phase 7: Calculate disk_gb from storage usage
    disk_gb = 0.0
    storage_usage = props.get("storage.perDatastoreUsage", [])
    if storage_usage:
        try:
            for usage in storage_usage:
                committed = getattr(usage, 'committed', 0) or 0
                disk_gb += committed / (1024**3)
            disk_gb = round(disk_gb, 2)
        except Exception:
            disk_gb = 0.0
    
    return {
        # Core identifiers
        "id": moref,                                    # MoRef as string
        "name": props.get("name", ""),                  # VM name
        "uuid": props.get("config.uuid", ""),           # VMware UUID
        
        # Relationship resolution
        "host_moref": host_moref,                       # Host MoRef for FK lookup
        "host_name": host_name,                         # Host name (display)
        "cluster_name": cluster_name,                   # Cluster name (Phase 3 key deliverable)
        
        # State
        "power_state": power_state,                     # poweredOn/poweredOff/suspended
        "connection_state": connection_state,           # connected/disconnected/orphaned
        
        # Storage path
        "vm_path_name": props.get("summary.config.vmPathName", ""),  # [datastore] path/to/vm.vmx
        
        # Phase 7: VM resources
        "cpu_count": cpu_count,
        "memory_mb": memory_mb,
        "disk_gb": disk_gb,
        
        # Phase 7: Guest info
        "guest_os": guest_os,
        "ip_address": ip_address,
        "is_template": is_template,
        
        # Phase 7: Tools info
        "tools_status": tools_status,
        "tools_version": tools_version,
    }


def _datastore_to_dict(obj, props: Dict, lookups: Dict) -> Dict[str, Any]:
    """
    Transform datastore to JSON-serializable dict.
    
    Phase 6+7 implementation - schema-aligned field names + host/vm counts.
    
    Args:
        obj: vim.Datastore object
        props: Dict of properties from PropertyCollector
        lookups: Dict of MoRef lookup maps (unused but consistent signature)
        
    Returns:
        Dict with datastore fields for database upsert
    """
    moref = str(obj._moId)
    capacity = props.get("summary.capacity", 0) or 0
    free_space = props.get("summary.freeSpace", 0) or 0
    
    # Phase 7: Count hosts and VMs if deep relationships enabled
    host_count = 0
    vm_count = 0
    hosts = props.get("host", [])
    vms = props.get("vm", [])
    if hosts:
        host_count = len(hosts) if hasattr(hosts, "__len__") else 0
    if vms:
        vm_count = len(vms) if hasattr(vms, "__len__") else 0
    
    return {
        "id": moref,
        "name": props.get("name", ""),
        "type": props.get("summary.type", ""),
        "capacity_bytes": capacity,
        "free_bytes": free_space,
        "used_bytes": capacity - free_space,
        "accessible": props.get("summary.accessible", True),
        # Phase 7: Host and VM counts
        "host_count": host_count,
        "vm_count": vm_count,
    }


def _extract_vlan_info(default_port_config) -> Dict[str, Any]:
    """
    Extract VLAN configuration from DVPG defaultPortConfig.
    
    VMware VLAN types:
    - vim.dvs.VmwareDistributedVirtualSwitch.VlanIdSpec - Single VLAN ID
    - vim.dvs.VmwareDistributedVirtualSwitch.TrunkVlanSpec - VLAN trunk ranges
    - vim.dvs.VmwareDistributedVirtualSwitch.PvlanSpec - Private VLAN
    
    Returns:
        {
            "vlan_id": int or None,
            "vlan_type": str (None, VlanIdSpec, TrunkSpec, PvlanSpec),
            "vlan_range": str or None (for trunk ranges)
        }
    """
    result = {
        "vlan_id": None,
        "vlan_type": None,
        "vlan_range": None,
    }
    
    if not default_port_config:
        return result
    
    vlan = getattr(default_port_config, "vlan", None)
    if not vlan:
        return result
    
    # Detect VLAN type by class name
    type_name = type(vlan).__name__
    
    if "VlanIdSpec" in type_name:
        result["vlan_type"] = "VlanIdSpec"
        result["vlan_id"] = getattr(vlan, "vlanId", None)
    elif "TrunkVlanSpec" in type_name:
        result["vlan_type"] = "TrunkSpec"
        # TrunkVlanSpec has vlanId as a list of NumericRange
        ranges = getattr(vlan, "vlanId", [])
        if ranges:
            range_strs = []
            for r in ranges:
                start = getattr(r, "start", 0)
                end = getattr(r, "end", 0)
                if start == end:
                    range_strs.append(str(start))
                else:
                    range_strs.append(f"{start}-{end}")
            result["vlan_range"] = ",".join(range_strs)
    elif "PvlanSpec" in type_name:
        result["vlan_type"] = "PvlanSpec"
        result["vlan_id"] = getattr(vlan, "pvlanId", None)
    
    return result


def _network_to_dict(obj, props: Dict[str, Any], lookups: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform standard vSphere Network to JSON-serializable dict.
    
    Standard networks (vim.Network) are non-distributed port groups on
    standard vSwitches. They have limited metadata compared to DVPGs.
    
    Args:
        obj: vim.Network object
        props: Dict of properties from PropertyCollector
        lookups: Dict of MoRef lookup maps
        
    Returns:
        Dict matching vcenter_networks schema
    """
    moref = str(obj._moId)
    
    # Count connected hosts/VMs if deep relationships enabled
    host_count = 0
    vm_count = 0
    hosts = props.get("host", [])
    vms = props.get("vm", [])
    if hosts:
        host_count = len(hosts) if hasattr(hosts, "__len__") else 0
    if vms:
        vm_count = len(vms) if hasattr(vms, "__len__") else 0
    
    return {
        # Core identifiers
        "vcenter_id": moref,                        # MoRef as string
        "name": props.get("name", ""),
        "network_type": "StandardNetwork",
        
        # VLAN (not available on standard networks)
        "vlan_id": None,
        "vlan_type": None,
        "vlan_range": None,
        
        # Parent switch (not tracked for standard networks)
        "parent_switch_name": None,
        "parent_switch_id": None,
        
        # Status
        "accessible": props.get("summary.accessible", True),
        
        # Counts (only populated if enable_deep=True)
        "host_count": host_count,
        "vm_count": vm_count,
        
        # Not an uplink
        "uplink_port_group": False,
    }


def _dvpg_to_dict(obj, props: Dict[str, Any], lookups: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform DistributedVirtualPortgroup to JSON-serializable dict.
    
    DVPGs are port groups on distributed virtual switches (DVS).
    They contain VLAN configuration, uplink detection, and parent DVS reference.
    
    Args:
        obj: vim.dvs.DistributedVirtualPortgroup object
        props: Dict of properties from PropertyCollector
        lookups: Dict of MoRef lookup maps (includes dvpg_moref_to_dvs)
        
    Returns:
        Dict matching vcenter_networks schema
    """
    moref = str(obj._moId)
    
    # Resolve parent DVS via lookup
    dvs_name = lookups.get("dvpg_moref_to_dvs", {}).get(moref, "")
    
    # Get parent DVS MoRef
    parent_switch_id = ""
    parent = props.get("parent")
    if parent and hasattr(parent, "_moId"):
        parent_switch_id = str(parent._moId)
    
    # Extract VLAN configuration
    default_port_config = props.get("config.defaultPortConfig")
    vlan_info = _extract_vlan_info(default_port_config)
    
    # Detect if this is an uplink port group by checking name pattern
    name = props.get("name", "")
    is_uplink = "uplink" in name.lower()
    
    # Count connected hosts/VMs if deep relationships enabled
    host_count = 0
    vm_count = 0
    hosts = props.get("host", [])
    vms = props.get("vm", [])
    if hosts:
        host_count = len(hosts) if hasattr(hosts, "__len__") else 0
    if vms:
        vm_count = len(vms) if hasattr(vms, "__len__") else 0
    
    return {
        # Core identifiers
        "vcenter_id": moref,                        # MoRef as string
        "name": name,
        "network_type": "DistributedVirtualPortgroup",
        
        # VLAN configuration
        "vlan_id": vlan_info["vlan_id"],
        "vlan_type": vlan_info["vlan_type"],
        "vlan_range": vlan_info["vlan_range"],
        
        # Parent DVS reference
        "parent_switch_name": dvs_name,
        "parent_switch_id": parent_switch_id,
        
        # Status
        "accessible": props.get("summary.accessible", True),
        
        # Counts (only populated if enable_deep=True)
        "host_count": host_count,
        "vm_count": vm_count,
        
        # Uplink detection
        "uplink_port_group": is_uplink,
    }


def _dvs_to_dict(obj, props: Dict[str, Any], lookups: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform VmwareDistributedVirtualSwitch to JSON-serializable dict.
    
    DVS objects are the parent switches for DVPGs. They don't have VLAN
    configuration themselves but serve as containers.
    
    Args:
        obj: vim.dvs.VmwareDistributedVirtualSwitch object
        props: Dict of properties from PropertyCollector
        lookups: Dict of MoRef lookup maps
        
    Returns:
        Dict matching vcenter_networks schema
    """
    moref = str(obj._moId)
    
    return {
        # Core identifiers
        "vcenter_id": moref,                        # MoRef as string
        "name": props.get("name", ""),
        "network_type": "VmwareDistributedVirtualSwitch",
        
        # DVS doesn't have VLAN config
        "vlan_id": None,
        "vlan_type": None,
        "vlan_range": None,
        
        # No parent (DVS is the parent)
        "parent_switch_name": None,
        "parent_switch_id": None,
        
        # DVS is always accessible if we can query it
        "accessible": True,
        
        # Port count from summary
        "host_count": 0,  # Not directly available
        "vm_count": 0,    # Not directly available
        
        # Not a port group
        "uplink_port_group": False,
        
        # DVS-specific
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
            clusters.append(_cluster_to_dict(obj, props, lookups))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"Cluster processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process hosts
    for obj, props in inventory["hosts"]:
        try:
            hosts.append(_host_to_dict(obj, props, lookups))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"Host processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process VMs
    for obj, props in inventory["vms"]:
        try:
            vms.append(_vm_to_dict(obj, props, lookups))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"VM processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process datastores
    for obj, props in inventory["datastores"]:
        try:
            datastores.append(_datastore_to_dict(obj, props, lookups))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"Datastore processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process networks
    for obj, props in inventory["networks"]:
        try:
            networks.append(_network_to_dict(obj, props, lookups))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"Network processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process DVPGs
    for obj, props in inventory["dvpgs"]:
        try:
            dvpgs.append(_dvpg_to_dict(obj, props, lookups))
        except Exception as e:
            errors.append({
                "object": str(obj._moId) if obj else "unknown",
                "message": f"DVPG processing error: {str(e)}",
                "severity": "warning"
            })
    
    # Process DVSwitches
    for obj, props in inventory["dvswitches"]:
        try:
            dvswitches.append(_dvs_to_dict(obj, props, lookups))
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
        "source_vcenter_id": source_vcenter_id,
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
        "counts": {
            "clusters": len(clusters),
            "hosts": len(hosts),
            "vms": len(vms),
            "datastores": len(datastores),
            "networks": len(networks),
            "dvpgs": len(dvpgs),
            "dvswitches": len(dvswitches),
        }
    }
