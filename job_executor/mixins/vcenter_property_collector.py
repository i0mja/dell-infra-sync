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
    """VM properties - Required set from spec + Phase 7 additions + Phase 8 network NICs + Phase 9 snapshots/attrs."""
    return [
        "name",
        "config.uuid",
        "config.template",                    # Phase 7: Is VM a template?
        "config.hardware.device",             # Phase 8: NICs for network relationships
        "config.version",                     # Phase 9: Hardware version (vmx-XX)
        "config.guestId",                     # Phase 10: Guest ID for VM creation (e.g., rhel7_64Guest)
        "config.firmware",                    # Phase 11: Firmware type (bios/efi) for DR shell boot
        "runtime.powerState",
        "summary.config.vmPathName",
        "summary.config.numCpu",              # Phase 7: CPU count
        "summary.config.memorySizeMB",        # Phase 7: Memory in MB
        "summary.config.guestFullName",       # Phase 7: Guest OS name
        "summary.config.guestId",             # Phase 10: Fallback guest ID
        "summary.runtime.host",
        "summary.runtime.connectionState",
        "guest.ipAddress",                    # Phase 7: Primary IP
        "guest.net",                          # Phase 8: Guest NIC info (IP per NIC)
        "guest.toolsStatus",                  # Phase 7: VMware Tools status
        "guest.toolsVersionStatus2",          # Phase 7: VMware Tools version status
        "storage.perDatastoreUsage",          # Phase 7: Disk usage by datastore
        "resourcePool",                       # Phase 9: Resource pool reference
        "parent",                             # Phase 9: Folder reference (for folder path)
        "snapshot",                           # Phase 9: Snapshot tree
        "availableField",                     # Phase 9: Custom attribute definitions
        "customValue",                        # Phase 9: Custom attribute values
    ]


def _get_host_properties() -> List[str]:
    """Host properties - Required set from spec + Phase 7 additions."""
    return [
        "name",
        "hardware.systemInfo.serialNumber",
        "hardware.systemInfo.otherIdentifyingInfo",  # Fallback for ESXi 7.x serial/ServiceTag
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
    """Datastore properties - Required + optional deep relationships.
    
    Note: 'host' is always fetched to populate vcenter_datastore_hosts table
    for proper cluster-aware datastore filtering.
    """
    props = [
        "name",
        "summary.capacity",
        "summary.freeSpace",
        "summary.type",
        "summary.accessible",                 # Phase 7: Accessibility
        "host",                               # Always fetch for datastore-host relationships
    ]
    if enable_deep:
        props.append("vm")
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
        
        logger.info(f"PropertyCollector fetched {len(objects)} TOTAL objects (before categorization)")
        
        # DEBUG: Count objects by type before categorization for diagnosis
        type_counts = {}
        for oc in objects:
            try:
                type_name = type(oc.obj).__name__
                type_counts[type_name] = type_counts.get(type_name, 0) + 1
            except:
                type_counts['unknown'] = type_counts.get('unknown', 0) + 1
        logger.info(f"PropertyCollector objects by type: {type_counts}")
        
        # Parse and categorize objects
        for obj_content in objects:
            try:
                obj, props = _parse_object_content(obj_content)
                type_name = type(obj).__name__
                full_type_str = str(type(obj))  # Full class path for pyVmomi
                moref_id = str(obj._moId) if hasattr(obj, '_moId') else ''
                
                if isinstance(obj, vim.VirtualMachine):
                    vms.append((obj, props))
                elif isinstance(obj, vim.HostSystem):
                    hosts.append((obj, props))
                elif isinstance(obj, vim.ClusterComputeResource):
                    clusters.append((obj, props))
                elif isinstance(obj, vim.Datastore):
                    datastores.append((obj, props))
                # DVPGs - multiple detection strategies including MoRef prefix fallback
                elif (isinstance(obj, vim.dvs.DistributedVirtualPortgroup) or 
                      'DistributedVirtualPortgroup' in type_name or
                      'DistributedVirtualPortgroup' in full_type_str or
                      moref_id.startswith('dvportgroup-')):
                    dvpgs.append((obj, props))
                    logger.info(f"Captured DVPG: {props.get('name', 'unknown')} (type: {type_name}, moref: {moref_id})")
                # DVS - multiple detection strategies including MoRef prefix fallback
                elif (isinstance(obj, vim.DistributedVirtualSwitch) or 
                      'DistributedVirtualSwitch' in type_name or
                      'DistributedVirtualSwitch' in full_type_str or
                      'VmwareDistributedVirtualSwitch' in type_name or
                      moref_id.startswith('dvs-')):
                    dvswitches.append((obj, props))
                    logger.info(f"Captured DVS: {props.get('name', 'unknown')} (type: {type_name}, moref: {moref_id})")
                # Standard networks - multiple detection strategies including MoRef prefix fallback
                elif (isinstance(obj, vim.Network) or 
                      type_name == 'Network' or
                      'vim.Network' in full_type_str or
                      moref_id.startswith('network-')):
                    networks.append((obj, props))
                    logger.info(f"Captured Network: {props.get('name', 'unknown')} (type: {type_name}, moref: {moref_id})")
                else:
                    # Log unrecognized types for debugging
                    logger.warning(f"Unrecognized object type: {type_name} (full: {full_type_str}, moref: {moref_id})")
                    
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
    
    # Summary logging for diagnostics - ENHANCED for debugging Marseille VM count issue
    logger.info(f"PropertyCollector FINAL COUNTS: clusters={len(clusters)}, hosts={len(hosts)}, "
                f"vms={len(vms)}, datastores={len(datastores)}, networks={len(networks)}, "
                f"dvpgs={len(dvpgs)}, dvswitches={len(dvswitches)}")
    
    # DEBUG: Log first few VM names to verify we're getting expected VMs
    if vms:
        sample_vm_names = [props.get('name', 'unknown') for _, props in vms[:5]]
        logger.info(f"Sample VMs fetched (first 5): {sample_vm_names}")
    
    # FALLBACK: If PropertyCollector returned no networks/DVPGs, use direct datacenter traversal
    if len(networks) == 0 and len(dvpgs) == 0 and len(dvswitches) == 0:
        logger.warning("PropertyCollector returned no networks - using direct datacenter traversal")
        try:
            direct_result = _collect_networks_direct(content)
            networks = direct_result['networks']
            dvpgs = direct_result['dvpgs']
            dvswitches = direct_result['dvswitches']
            logger.info(f"Direct traversal recovered: {len(networks)} networks, "
                        f"{len(dvpgs)} DVPGs, {len(dvswitches)} DVSwitches")
        except Exception as e:
            logger.error(f"Direct network collection failed: {e}")
            errors.append({
                "object": "DirectNetworkCollection",
                "message": f"Direct network traversal failed: {str(e)}",
                "severity": "warning"
            })
    
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
# Direct Network Collection (Fallback for PropertyCollector)
# =============================================================================

def _process_network_folder_entities(
    entities,
    networks: List,
    dvpgs: List,
    dvswitches: List,
    parent_folder: str = ""
):
    """
    Recursively process network folder entities, handling nested folders.
    
    Args:
        entities: List of network folder childEntity objects
        networks: List to append standard networks to
        dvpgs: List to append DVPGs to  
        dvswitches: List to append DVSwitches to
        parent_folder: Parent folder path for logging
    """
    if not entities:
        return
        
    for net_obj in entities:
        try:
            type_name = type(net_obj).__name__
            moref_id = str(net_obj._moId) if hasattr(net_obj, '_moId') else ''
            
            logger.debug(f"Processing network object: type={type_name}, moref={moref_id}, folder={parent_folder}")
            
            # RECURSIVE: Handle network folders FIRST
            if 'Folder' in type_name and hasattr(net_obj, 'childEntity') and net_obj.childEntity:
                folder_name = getattr(net_obj, 'name', 'Unknown')
                folder_path = f"{parent_folder}/{folder_name}" if parent_folder else folder_name
                logger.info(f"Direct: Recursing into network folder: {folder_path}")
                _process_network_folder_entities(
                    net_obj.childEntity, networks, dvpgs, dvswitches, folder_path
                )
                continue
            
            # Check for DVS (VmwareDistributedVirtualSwitch or DistributedVirtualSwitch)
            if 'DistributedVirtualSwitch' in type_name or moref_id.startswith('dvs-'):
                dvs_props = {
                    'name': getattr(net_obj, 'name', 'Unknown'),
                    'uuid': getattr(net_obj, 'uuid', None) if hasattr(net_obj, 'uuid') else None,
                }
                # Get summary.numPorts if available
                if hasattr(net_obj, 'summary') and hasattr(net_obj.summary, 'numPorts'):
                    dvs_props['summary.numPorts'] = net_obj.summary.numPorts
                else:
                    dvs_props['summary.numPorts'] = 0
                    
                dvswitches.append((net_obj, dvs_props))
                logger.info(f"Direct: Captured DVS: {dvs_props['name']} (moref: {moref_id}, folder: {parent_folder})")
                
                # DVPGs are accessible via dvs.portgroup property
                if hasattr(net_obj, 'portgroup') and net_obj.portgroup:
                    for pg in net_obj.portgroup:
                        try:
                            pg_moref = str(pg._moId) if hasattr(pg, '_moId') else ''
                            pg_props = {
                                'name': getattr(pg, 'name', 'Unknown'),
                                'parent': net_obj,  # DVS reference
                            }
                            
                            # Get VLAN config from defaultPortConfig
                            if hasattr(pg, 'config') and pg.config:
                                if hasattr(pg.config, 'defaultPortConfig') and pg.config.defaultPortConfig:
                                    pg_props['config.defaultPortConfig'] = pg.config.defaultPortConfig
                            
                            # Get accessibility
                            if hasattr(pg, 'summary') and hasattr(pg.summary, 'accessible'):
                                pg_props['summary.accessible'] = pg.summary.accessible
                            
                            dvpgs.append((pg, pg_props))
                            logger.info(f"Direct: Captured DVPG: {pg_props['name']} from DVS {dvs_props['name']} (moref: {pg_moref})")
                        except Exception as pg_err:
                            logger.warning(f"Error processing portgroup: {pg_err}")
                            
            # Check for standard Network
            elif type_name == 'Network' or moref_id.startswith('network-'):
                net_props = {
                    'name': getattr(net_obj, 'name', 'Unknown'),
                }
                # Get accessibility
                if hasattr(net_obj, 'summary') and hasattr(net_obj.summary, 'accessible'):
                    net_props['summary.accessible'] = net_obj.summary.accessible
                else:
                    net_props['summary.accessible'] = True  # Assume accessible if we can see it
                    
                networks.append((net_obj, net_props))
                logger.info(f"Direct: Captured Network: {net_props['name']} (moref: {moref_id}, folder: {parent_folder})")
                
            # Fallback: check if it has childEntity but wasn't caught as Folder
            elif hasattr(net_obj, 'childEntity') and net_obj.childEntity:
                folder_name = getattr(net_obj, 'name', 'Unknown')
                folder_path = f"{parent_folder}/{folder_name}" if parent_folder else folder_name
                logger.info(f"Direct: Found container object with children: {folder_path} (type: {type_name})")
                _process_network_folder_entities(
                    net_obj.childEntity, networks, dvpgs, dvswitches, folder_path
                )
                
            else:
                logger.debug(f"Skipping unknown network type: {type_name} (moref: {moref_id})")
                
        except Exception as obj_err:
            logger.warning(f"Error processing network object: {obj_err}")


def _collect_networks_direct(content) -> Dict[str, List]:
    """
    Collect networks using direct datacenter traversal (VMware recommended approach).
    
    This is the proven method from VMware community samples that reliably
    retrieves all networks, DVS, and DVPGs when PropertyCollector fails.
    
    DVPGs are NOT directly in networkFolder - they are accessed via dvs.portgroup property.
    
    Args:
        content: vim.ServiceInstanceContent from vCenter connection
        
    Returns:
        Dict with 'networks', 'dvpgs', 'dvswitches' lists of (obj, props) tuples
    """
    networks = []
    dvpgs = []
    dvswitches = []
    
    logger.info("=" * 60)
    logger.info("NETWORK COLLECTION DEBUG: Starting direct datacenter traversal")
    logger.info("=" * 60)
    
    # Log root folder info
    root_children = content.rootFolder.childEntity if hasattr(content.rootFolder, 'childEntity') else []
    logger.info(f"Root folder has {len(root_children)} child entities")
    
    # Iterate through all datacenters
    for child_idx, child in enumerate(root_children):
        child_type = type(child).__name__
        child_name = getattr(child, 'name', 'Unknown')
        logger.info(f"Root child [{child_idx}]: {child_name} (type: {child_type})")
        
        # Handle both Datacenter and Folder objects
        datacenters = []
        if hasattr(child, 'networkFolder'):
            datacenters = [child]
        elif hasattr(child, 'childEntity'):
            # It's a folder, recurse into it
            logger.info(f"  -> {child_name} is a folder, checking for datacenters inside...")
            for sub in child.childEntity:
                sub_type = type(sub).__name__
                sub_name = getattr(sub, 'name', 'Unknown')
                logger.info(f"    Sub-object: {sub_name} (type: {sub_type})")
                if hasattr(sub, 'networkFolder'):
                    datacenters.append(sub)
        
        for datacenter in datacenters:
            dc_name = getattr(datacenter, 'name', 'Unknown')
            logger.info(f"Traversing datacenter networkFolder: {dc_name}")
            
            try:
                # Get all network objects from networkFolder
                if not hasattr(datacenter, 'networkFolder') or not datacenter.networkFolder:
                    logger.warning(f"Datacenter {dc_name} has no networkFolder")
                    continue
                    
                network_folder = datacenter.networkFolder
                network_folder_name = getattr(network_folder, 'name', 'Unknown')
                logger.info(f"  Network folder object: {network_folder_name} (type: {type(network_folder).__name__})")
                
                if not hasattr(network_folder, 'childEntity'):
                    logger.warning(f"Datacenter {dc_name} networkFolder has no childEntity attribute")
                    continue
                    
                if not network_folder.childEntity:
                    logger.warning(f"Datacenter {dc_name} networkFolder.childEntity is empty/None")
                    continue
                
                entity_count = len(network_folder.childEntity)
                logger.info(f"Datacenter {dc_name} networkFolder has {entity_count} top-level entities")
                
                # Log each top-level entity type for debugging
                for ent_idx, ent in enumerate(network_folder.childEntity):
                    ent_type = type(ent).__name__
                    ent_name = getattr(ent, 'name', 'Unknown')
                    ent_moref = str(ent._moId) if hasattr(ent, '_moId') else 'no-moref'
                    has_children = hasattr(ent, 'childEntity') and ent.childEntity
                    logger.info(f"  Entity [{ent_idx}]: {ent_name} (type: {ent_type}, moref: {ent_moref}, has_children: {has_children})")
                
                # Use recursive function to handle nested folders
                _process_network_folder_entities(
                    network_folder.childEntity,
                    networks,
                    dvpgs,
                    dvswitches,
                    parent_folder=""
                )
                        
            except Exception as dc_err:
                logger.error(f"Error traversing datacenter {dc_name}: {dc_err}", exc_info=True)
    
    logger.info("=" * 60)
    logger.info(f"NETWORK COLLECTION COMPLETE: {len(networks)} networks, "
                f"{len(dvpgs)} DVPGs, {len(dvswitches)} DVSwitches")
    logger.info("=" * 60)
    
    return {
        'networks': networks,
        'dvpgs': dvpgs,
        'dvswitches': dvswitches,
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
        host_name = props.get("name", "")
        host_moref_to_name[moref] = host_name
        
        # Resolve parent cluster (MoRef and name)
        parent = props.get("parent")
        if parent and hasattr(parent, "_moId"):
            cluster_moref = str(parent._moId)
            host_moref_to_cluster[moref] = cluster_moref
            cluster_name = cluster_moref_to_name.get(cluster_moref, "")
            host_moref_to_cluster_name[moref] = cluster_name
            logger.info(f"[HostClusterMapping] Host '{host_name}' -> parent moref={cluster_moref} -> cluster='{cluster_name}'")
        else:
            logger.warning(f"[HostClusterMapping] Host '{host_name}' has no parent cluster (parent={parent})")
        
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
    
    # Get serial from primary property, fallback to otherIdentifyingInfo for ESXi 7.x
    serial_number = props.get("hardware.systemInfo.serialNumber", "") or ""
    if not serial_number:
        other_info = props.get("hardware.systemInfo.otherIdentifyingInfo")
        serial_number = _extract_serial_from_other_info(other_info)
    
    return {
        "id": moref,
        "name": props.get("name", ""),
        "serial_number": serial_number,
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


def _extract_serial_from_other_info(other_info) -> str:
    """
    Extract serial/service tag from otherIdentifyingInfo array.
    
    Dell servers store ServiceTag in otherIdentifyingInfo on ESXi 7.x
    where hardware.systemInfo.serialNumber may be empty.
    
    Args:
        other_info: List of HostSystemIdentificationInfo objects
        
    Returns:
        Serial number string or empty string if not found
    """
    if not other_info:
        return ""
    
    # Look for ServiceTag or EnclosureSerialNumberTag identifiers
    for info in other_info:
        try:
            id_type = getattr(info, 'identifierType', None)
            if id_type:
                key_str = str(getattr(id_type, 'key', ''))
                # Dell uses ServiceTag for the server serial
                if 'ServiceTag' in key_str or 'SerialNumber' in key_str:
                    value = getattr(info, 'identifierValue', '') or ''
                    if value:
                        return str(value)
        except Exception:
            continue
    
    return ""


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


def _process_snapshot_tree(snapshot_list, parent_id: str = None) -> List[Dict[str, Any]]:
    """
    Recursively flatten vCenter snapshot tree into a list.
    
    Args:
        snapshot_list: List of vim.vm.SnapshotTree objects
        parent_id: Parent snapshot MoRef ID
        
    Returns:
        List of snapshot dicts with parent references
    """
    snapshots = []
    if not snapshot_list:
        return snapshots
    
    try:
        for snap in snapshot_list:
            snap_moref = str(snap.snapshot._moId) if hasattr(snap.snapshot, '_moId') else str(snap.id)
            created_at = None
            if hasattr(snap, 'createTime') and snap.createTime:
                try:
                    created_at = snap.createTime.isoformat()
                except Exception:
                    pass
            
            snapshots.append({
                'snapshot_id': snap_moref,
                'name': getattr(snap, 'name', '') or '',
                'description': getattr(snap, 'description', '') or '',
                'created_at': created_at,
                'parent_snapshot_id': parent_id,
            })
            
            # Recurse into children
            if hasattr(snap, 'childSnapshotList') and snap.childSnapshotList:
                snapshots.extend(_process_snapshot_tree(snap.childSnapshotList, snap_moref))
    except Exception as e:
        logger.warning(f"Error processing snapshot tree: {e}")
    
    return snapshots


def _get_folder_path(parent_folder) -> str:
    """
    Build folder path by traversing parent folders.
    
    Args:
        parent_folder: vim.Folder object (parent of VM)
        
    Returns:
        Folder path string like "Datacenter/vm/Production/AppServers"
    """
    path_parts = []
    current = parent_folder
    max_depth = 20  # Safety limit
    depth = 0
    
    try:
        while current and depth < max_depth:
            if hasattr(current, 'name'):
                name = str(current.name)
                # Skip root folder (usually named "Datacenters" or similar)
                if name and name != 'Datacenters':
                    path_parts.insert(0, name)
            
            # Move to parent
            if hasattr(current, 'parent') and current.parent:
                current = current.parent
            else:
                break
            depth += 1
    except Exception as e:
        logger.warning(f"Error building folder path: {e}")
    
    return '/'.join(path_parts) if path_parts else ''


def _vm_to_dict(obj, props: Dict, lookups: Dict) -> Dict[str, Any]:
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
    # Phase 10: Extract guestId for VM creation (prefer config.guestId, fallback to summary)
    guest_id = props.get("config.guestId", "") or props.get("summary.config.guestId", "") or ""
    # Phase 11: Extract firmware type for DR shell boot (bios/efi)
    firmware = props.get("config.firmware", "") or ""
    if firmware:
        firmware = str(firmware).lower()  # Normalize to lowercase
    if firmware not in ('bios', 'efi'):
        firmware = 'bios'  # Default to BIOS if not specified
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
    # Phase 9: Extract per-datastore usage for vcenter_datastore_vms table
    disk_gb = 0.0
    datastore_usage = []  # List of {datastore_moref, committed_bytes, uncommitted_bytes, is_primary}
    storage_usage = props.get("storage.perDatastoreUsage", [])
    vm_path_name = props.get("summary.config.vmPathName", "")
    
    # Extract primary datastore from vmPathName (format: "[datastore_name] path/to/vm.vmx")
    primary_datastore_name = ""
    if vm_path_name and vm_path_name.startswith("["):
        try:
            primary_datastore_name = vm_path_name[1:vm_path_name.index("]")]
        except (ValueError, IndexError):
            pass
    
    if storage_usage:
        try:
            for usage in storage_usage:
                committed = getattr(usage, 'committed', 0) or 0
                uncommitted = getattr(usage, 'uncommitted', 0) or 0
                disk_gb += committed / (1024**3)
                
                # Get datastore reference
                ds_ref = getattr(usage, 'datastore', None)
                if ds_ref and hasattr(ds_ref, '_moId'):
                    ds_moref = str(ds_ref._moId)
                    ds_name = getattr(ds_ref, 'name', '') if hasattr(ds_ref, 'name') else ''
                    
                    # Check if this is the primary datastore (where .vmx lives)
                    is_primary = (ds_name == primary_datastore_name) if primary_datastore_name and ds_name else False
                    
                    datastore_usage.append({
                        'datastore_moref': ds_moref,
                        'committed_bytes': committed,
                        'uncommitted_bytes': uncommitted,
                        'is_primary': is_primary,
                    })
            disk_gb = round(disk_gb, 2)
        except Exception:
            disk_gb = 0.0
    
    # Phase 8: Extract network interfaces (NICs)
    # Phase 12: Extract SCSI controller type
    network_interfaces = []
    scsi_controller_type = 'lsilogic'  # Default to LSI Logic Parallel
    devices = props.get("config.hardware.device", [])
    guest_nets = props.get("guest.net", [])
    
    # Build a map of MAC address -> guest NIC info for IP resolution
    mac_to_guest_info = {}
    if guest_nets:
        try:
            for gnic in guest_nets:
                mac = getattr(gnic, 'macAddress', None)
                if mac:
                    ip_addresses = []
                    ip_config = getattr(gnic, 'ipConfig', None)
                    if ip_config:
                        ip_addrs = getattr(ip_config, 'ipAddress', [])
                        for ip_obj in ip_addrs:
                            ip = getattr(ip_obj, 'ipAddress', None)
                            if ip:
                                ip_addresses.append(ip)
                    mac_to_guest_info[mac.lower()] = {
                        'ip_addresses': ip_addresses,
                        'connected': getattr(gnic, 'connected', True)
                    }
        except Exception:
            pass
    
    if devices:
        try:
            for device in devices:
                device_type = type(device).__name__
                
                # Phase 12: Check for SCSI controllers (extract first one found)
                if scsi_controller_type == 'lsilogic':  # Only update if still default
                    if 'ParaVirtualSCSIController' in device_type:
                        scsi_controller_type = 'pvscsi'
                    elif 'VirtualLsiLogicSASController' in device_type:
                        scsi_controller_type = 'lsilogic-sas'
                    elif 'VirtualBusLogicController' in device_type:
                        scsi_controller_type = 'buslogic'
                    elif 'VirtualLsiLogicController' in device_type:
                        scsi_controller_type = 'lsilogic'
                
                # Check if it's a virtual ethernet adapter
                if 'VirtualEthernetCard' in device_type or 'VirtualVmxnet' in device_type or 'VirtualE1000' in device_type:
                    backing = getattr(device, 'backing', None)
                    network_moref = None
                    network_name = None
                    
                    if backing:
                        # DVS backing
                        if hasattr(backing, 'port') and hasattr(backing.port, 'portgroupKey'):
                            network_moref = backing.port.portgroupKey
                        # Standard network backing
                        elif hasattr(backing, 'network') and hasattr(backing.network, '_moId'):
                            network_moref = str(backing.network._moId)
                        # Network name from deviceName
                        if hasattr(backing, 'deviceName'):
                            network_name = backing.deviceName
                    
                    mac_address = getattr(device, 'macAddress', None)
                    nic_label = getattr(device.deviceInfo, 'label', None) if hasattr(device, 'deviceInfo') else None
                    connectable = getattr(device, 'connectable', None)
                    connected = getattr(connectable, 'connected', True) if connectable else True
                    
                    # Get IP addresses from guest info via MAC address
                    ip_addresses = []
                    if mac_address and mac_address.lower() in mac_to_guest_info:
                        guest_info = mac_to_guest_info[mac_address.lower()]
                        ip_addresses = guest_info.get('ip_addresses', [])
                        connected = guest_info.get('connected', connected)
                    
                    network_interfaces.append({
                        'network_moref': network_moref,
                        'network_name': network_name,
                        'nic_label': nic_label,
                        'mac_address': mac_address,
                        'adapter_type': device_type,
                        'connected': connected,
                        'ip_addresses': ip_addresses,
                    })
        except Exception as e:
            logger.warning(f"Error extracting NICs/SCSI for VM {props.get('name', '')}: {e}")
    
    # Phase 9: Extract resource pool name
    resource_pool = ""
    rp_ref = props.get("resourcePool")
    if rp_ref and hasattr(rp_ref, 'name'):
        try:
            resource_pool = str(rp_ref.name)
        except Exception:
            pass
    
    # Phase 9: Extract hardware version (e.g., "vmx-19")
    hardware_version = props.get("config.version", "") or ""
    
    # Phase 9: Extract folder path by traversing parent chain
    folder_path = ""
    parent_folder = props.get("parent")
    if parent_folder:
        folder_path = _get_folder_path(parent_folder)
    
    # Phase 9: Extract snapshots from snapshot tree
    snapshots = []
    current_snapshot_moref = None
    snapshot_info = props.get("snapshot")
    if snapshot_info:
        try:
            if hasattr(snapshot_info, 'currentSnapshot') and snapshot_info.currentSnapshot:
                current_snapshot_moref = str(snapshot_info.currentSnapshot._moId)
            if hasattr(snapshot_info, 'rootSnapshotList') and snapshot_info.rootSnapshotList:
                snapshots = _process_snapshot_tree(snapshot_info.rootSnapshotList)
                # Mark current snapshot
                for snap in snapshots:
                    snap['is_current'] = (snap['snapshot_id'] == current_snapshot_moref)
        except Exception as e:
            logger.warning(f"Error extracting snapshots for VM {props.get('name', '')}: {e}")
    
    # Phase 9: Extract custom attributes
    custom_attributes = []
    available_fields = props.get("availableField", [])
    custom_values = props.get("customValue", [])
    if available_fields and custom_values:
        try:
            # Build field key -> name map
            field_map = {}
            for field in available_fields:
                key = getattr(field, 'key', None)
                name = getattr(field, 'name', None)
                if key is not None and name:
                    field_map[key] = str(name)
            
            # Extract custom values
            for cv in custom_values:
                key = getattr(cv, 'key', None)
                value = getattr(cv, 'value', None)
                if key in field_map:
                    custom_attributes.append({
                        'attribute_key': field_map[key],
                        'attribute_value': str(value) if value is not None else ''
                    })
        except Exception as e:
            logger.warning(f"Error extracting custom attributes for VM {props.get('name', '')}: {e}")
    
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
        "guest_id": guest_id,                               # Phase 10: vSphere guestId for VM creation
        "firmware": firmware,                               # Phase 11: Firmware type (bios/efi)
        "scsi_controller_type": scsi_controller_type,       # Phase 12: SCSI controller type
        "ip_address": ip_address,
        "is_template": is_template,
        
        # Phase 7: Tools info
        "tools_status": tools_status,
        "tools_version": tools_version,
        
        # Phase 8: Network interfaces
        "network_interfaces": network_interfaces,
        
        # Phase 9: Datastore usage (for vcenter_datastore_vms table)
        "datastore_usage": datastore_usage,
        
        # Phase 9: New fields
        "resource_pool": resource_pool,
        "hardware_version": hardware_version,
        "folder_path": folder_path,
        "snapshots": snapshots,
        "snapshot_count": len(snapshots),
        "custom_attributes": custom_attributes,
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
    
    # Extract host relationships for vcenter_datastore_hosts table
    host_count = 0
    host_morefs = []
    hosts = props.get("host", [])
    if hosts:
        try:
            for host_mount in hosts:
                # Each item is a vim.Datastore.HostMount with key=HostSystem ref
                if hasattr(host_mount, 'key') and hasattr(host_mount.key, '_moId'):
                    host_morefs.append(str(host_mount.key._moId))
            host_count = len(host_morefs)
        except Exception as e:
            logger.warning(f"Error extracting host mounts for datastore {props.get('name', '')}: {e}")
    
    # Count VMs if deep relationships enabled
    vm_count = 0
    vms = props.get("vm", [])
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
        # Host relationships
        "host_count": host_count,
        "host_morefs": host_morefs,  # List of host MoRefs for relationship table
        # VM count
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


# =============================================================================
# Partial/Granular Sync Functions (for per-tab syncing)
# =============================================================================

def _get_type_for_scope(scope: str):
    """Get vim types for a sync scope."""
    scope_map = {
        'vms': [vim.VirtualMachine],
        'hosts': [vim.HostSystem],
        'clusters': [vim.ClusterComputeResource],
        'datastores': [vim.Datastore],
        'networks': [vim.Network, vim.dvs.DistributedVirtualPortgroup, vim.DistributedVirtualSwitch],
    }
    return scope_map.get(scope, [])


def _get_property_spec_for_scope(scope: str, enable_deep: bool = False):
    """Get PropertySpec for a specific scope."""
    specs = []
    
    if scope == 'vms':
        specs.append(vim.PropertyCollector.PropertySpec(
            type=vim.VirtualMachine,
            pathSet=_get_vm_properties(),
            all=False
        ))
    elif scope == 'hosts':
        specs.append(vim.PropertyCollector.PropertySpec(
            type=vim.HostSystem,
            pathSet=_get_host_properties(),
            all=False
        ))
        # Also need clusters for host->cluster resolution
        specs.append(vim.PropertyCollector.PropertySpec(
            type=vim.ClusterComputeResource,
            pathSet=["name"],
            all=False
        ))
    elif scope == 'clusters':
        specs.append(vim.PropertyCollector.PropertySpec(
            type=vim.ClusterComputeResource,
            pathSet=_get_cluster_properties(),
            all=False
        ))
    elif scope == 'datastores':
        specs.append(vim.PropertyCollector.PropertySpec(
            type=vim.Datastore,
            pathSet=_get_datastore_properties(enable_deep),
            all=False
        ))
    elif scope == 'networks':
        specs.append(vim.PropertyCollector.PropertySpec(
            type=vim.Network,
            pathSet=_get_network_properties(enable_deep),
            all=False
        ))
        specs.append(vim.PropertyCollector.PropertySpec(
            type=vim.dvs.DistributedVirtualPortgroup,
            pathSet=_get_dvpg_properties(enable_deep),
            all=False
        ))
        specs.append(vim.PropertyCollector.PropertySpec(
            type=vim.DistributedVirtualSwitch,
            pathSet=_get_dvs_properties(),
            all=False
        ))
    
    return specs


def collect_vcenter_inventory_partial(
    content,
    sync_scope: str,
    enable_deep: bool = None
) -> Dict[str, Any]:
    """
    Collect PARTIAL inventory for a specific scope (vms, hosts, clusters, datastores, networks).
    
    Args:
        content: vim.ServiceContent from si.RetrieveContent()
        sync_scope: "vms", "hosts", "clusters", "datastores", or "networks"
        enable_deep: Override ENABLE_DEEP_RELATIONSHIPS flag
        
    Returns:
        Dict with the requested object type's raw tuples
    """
    if enable_deep is None:
        enable_deep = ENABLE_DEEP_RELATIONSHIPS
    
    start_time = time.time()
    errors = []
    
    vim_types = _get_type_for_scope(sync_scope)
    if not vim_types:
        return {"errors": [{"message": f"Unknown scope: {sync_scope}"}], "fetch_time_ms": 0}
    
    # For hosts, we also need clusters for resolution
    if sync_scope == 'hosts':
        vim_types.append(vim.ClusterComputeResource)
    
    view_ref = None
    objects_raw = {}
    
    try:
        view_ref = content.viewManager.CreateContainerView(
            container=content.rootFolder,
            type=vim_types,
            recursive=True
        )
        
        traversal_spec = _build_traversal_spec()
        obj_spec = vim.PropertyCollector.ObjectSpec(
            obj=view_ref,
            selectSet=[traversal_spec],
            skip=False
        )
        
        property_specs = _get_property_spec_for_scope(sync_scope, enable_deep)
        
        filter_spec = vim.PropertyCollector.FilterSpec(
            objectSet=[obj_spec],
            propSet=property_specs
        )
        
        pc = content.propertyCollector
        options = vim.PropertyCollector.RetrieveOptions(maxObjects=1000)
        
        result = pc.RetrievePropertiesEx(specSet=[filter_spec], options=options)
        
        all_objects = result.objects or []
        token = result.token
        
        while token:
            result = pc.ContinueRetrievePropertiesEx(token)
            all_objects.extend(result.objects or [])
            token = result.token
        
        logger.info(f"Partial PropertyCollector fetched {len(all_objects)} objects for scope '{sync_scope}'")
        
        # Categorize objects
        for obj_content in all_objects:
            try:
                obj, props = _parse_object_content(obj_content)
                
                if isinstance(obj, vim.VirtualMachine):
                    objects_raw.setdefault('vms', []).append((obj, props))
                elif isinstance(obj, vim.HostSystem):
                    objects_raw.setdefault('hosts', []).append((obj, props))
                elif isinstance(obj, vim.ClusterComputeResource):
                    objects_raw.setdefault('clusters', []).append((obj, props))
                elif isinstance(obj, vim.Datastore):
                    objects_raw.setdefault('datastores', []).append((obj, props))
                elif isinstance(obj, vim.dvs.DistributedVirtualPortgroup):
                    objects_raw.setdefault('dvpgs', []).append((obj, props))
                elif isinstance(obj, vim.DistributedVirtualSwitch):
                    objects_raw.setdefault('dvswitches', []).append((obj, props))
                elif isinstance(obj, vim.Network):
                    objects_raw.setdefault('networks', []).append((obj, props))
                    
            except Exception as e:
                errors.append({
                    "object": str(obj_content.obj) if obj_content else "unknown",
                    "message": str(e),
                    "severity": "warning"
                })
                
    except Exception as e:
        errors.append({
            "object": "PropertyCollector",
            "message": f"Partial collection error: {str(e)}",
            "severity": "error"
        })
        logger.error(f"Partial PropertyCollector error: {e}")
        
    finally:
        if view_ref:
            try:
                view_ref.Destroy()
            except:
                pass
    
    fetch_time_ms = int((time.time() - start_time) * 1000)
    
    return {
        **objects_raw,
        "errors": errors,
        "fetch_time_ms": fetch_time_ms,
    }


def sync_vcenter_partial(
    content,
    source_vcenter_id: Optional[str] = None,
    sync_scope: str = "vms",
    enable_deep: bool = None
) -> Dict[str, Any]:
    """
    Partial sync for a specific entity type.
    
    Args:
        content: vim.ServiceContent from si.RetrieveContent()
        source_vcenter_id: vCenter ID for tracking
        sync_scope: "vms", "hosts", "clusters", "datastores", or "networks"
        enable_deep: Override ENABLE_DEEP_RELATIONSHIPS flag
        
    Returns:
        {
            "scope": str,
            "items": [...],  # JSON-serializable list
            "count": int,
            "fetch_time_ms": int,
            "process_time_ms": int,
            "errors": [...]
        }
    """
    inventory = collect_vcenter_inventory_partial(content, sync_scope, enable_deep)
    
    process_start = time.time()
    errors = list(inventory.get("errors", []))
    
    # Build lookup maps (minimal for partial sync)
    lookups = {
        'host_moref_to_cluster': {},
        'cluster_moref_to_name': {},
        'host_moref_to_name': {},
        'datastore_moref_to_name': {},
        'cluster_moref_to_datastores': {},
        'dvs_moref_to_name': {},
    }
    
    # If we have clusters (always for hosts scope), build lookup
    for obj, props in inventory.get('clusters', []):
        moref = str(obj._moId)
        name = props.get('name', '')
        lookups['cluster_moref_to_name'][moref] = name
    
    # If we have hosts, build host lookups
    for obj, props in inventory.get('hosts', []):
        moref = str(obj._moId)
        name = props.get('name', '')
        lookups['host_moref_to_name'][moref] = name
        
        parent = props.get('parent')
        if parent and isinstance(parent, vim.ClusterComputeResource):
            cluster_moref = str(parent._moId)
            lookups['host_moref_to_cluster'][moref] = lookups['cluster_moref_to_name'].get(cluster_moref, '')
    
    # Transform to JSON-serializable
    items = []
    
    if sync_scope == 'vms':
        for obj, props in inventory.get('vms', []):
            try:
                items.append(_vm_to_dict(obj, props, lookups))
            except Exception as e:
                errors.append({"object": str(obj._moId), "message": str(e)})
                
    elif sync_scope == 'hosts':
        for obj, props in inventory.get('hosts', []):
            try:
                items.append(_host_to_dict(obj, props, lookups))
            except Exception as e:
                errors.append({"object": str(obj._moId), "message": str(e)})
                
    elif sync_scope == 'clusters':
        for obj, props in inventory.get('clusters', []):
            try:
                items.append(_cluster_to_dict(obj, props, lookups))
            except Exception as e:
                errors.append({"object": str(obj._moId), "message": str(e)})
                
    elif sync_scope == 'datastores':
        for obj, props in inventory.get('datastores', []):
            try:
                items.append(_datastore_to_dict(obj, props, lookups))
            except Exception as e:
                errors.append({"object": str(obj._moId), "message": str(e)})
                
    elif sync_scope == 'networks':
        # Process standard networks, DVPGs, and DVSwitches
        for obj, props in inventory.get('networks', []):
            try:
                items.append(_network_to_dict(obj, props, lookups))
            except Exception as e:
                errors.append({"object": str(obj._moId), "message": str(e)})
        for obj, props in inventory.get('dvpgs', []):
            try:
                items.append(_dvpg_to_dict(obj, props, lookups))
            except Exception as e:
                errors.append({"object": str(obj._moId), "message": str(e)})
    
    process_time_ms = int((time.time() - process_start) * 1000)
    
    logger.info(f"sync_vcenter_partial completed: {len(items)} {sync_scope}, "
                f"fetch={inventory.get('fetch_time_ms', 0)}ms, process={process_time_ms}ms")
    
    return {
        "scope": sync_scope,
        "items": items,
        "count": len(items),
        "source_vcenter_id": source_vcenter_id,
        "fetch_time_ms": inventory.get("fetch_time_ms", 0),
        "process_time_ms": process_time_ms,
        "errors": errors,
    }
