/**
 * Centralized column definitions for all vCenter tables.
 * Single source of truth for column visibility, labels, and ordering.
 */

export interface ColumnDefinition {
  key: string;
  label: string;
  defaultVisible?: boolean;
  width?: string;
  sortField?: string;
}

// ============= CLUSTER COLUMNS =============
export const CLUSTER_COLUMNS: ColumnDefinition[] = [
  { key: "name", label: "Cluster Name", defaultVisible: true, width: "220px", sortField: "cluster_name" },
  { key: "vcenter", label: "vCenter", defaultVisible: false, width: "120px", sortField: "source_vcenter_id" },
  { key: "status", label: "Status", defaultVisible: true, width: "100px", sortField: "overall_status" },
  { key: "hosts", label: "Hosts", defaultVisible: true, width: "80px", sortField: "host_count" },
  { key: "vms", label: "VMs", defaultVisible: true, width: "80px", sortField: "vm_count" },
  { key: "ha", label: "HA", defaultVisible: true, width: "80px", sortField: "ha_enabled" },
  { key: "drs", label: "DRS", defaultVisible: true, width: "140px", sortField: "drs_enabled" },
  { key: "drsLevel", label: "DRS Level", defaultVisible: false, width: "120px", sortField: "drs_automation_level" },
  { key: "cpu", label: "CPU Usage", defaultVisible: true, width: "140px", sortField: "cpu_usage" },
  { key: "memory", label: "Memory Usage", defaultVisible: true, width: "140px", sortField: "memory_usage" },
  { key: "storage", label: "Storage Usage", defaultVisible: true, width: "180px", sortField: "storage_usage" },
  { key: "sync", label: "Last Sync", defaultVisible: true, width: "140px", sortField: "last_sync" },
];

export const CLUSTER_DEFAULT_COLUMNS = CLUSTER_COLUMNS.filter(c => c.defaultVisible !== false).map(c => c.key);

// ============= HOST COLUMNS =============
export const HOST_COLUMNS: ColumnDefinition[] = [
  { key: "name", label: "Hostname", defaultVisible: true, width: "200px", sortField: "name" },
  { key: "cluster", label: "Cluster", defaultVisible: false, width: "120px", sortField: "cluster" },
  { key: "status", label: "Status", defaultVisible: true, width: "100px", sortField: "status" },
  { key: "maintenance", label: "Maintenance", defaultVisible: false, width: "100px", sortField: "maintenance_mode" },
  { key: "esxi", label: "ESXi Version", defaultVisible: true, width: "100px", sortField: "esxi_version" },
  { key: "cpu", label: "CPU Usage", defaultVisible: false, width: "120px", sortField: "cpu_usage_mhz" },
  { key: "memory", label: "Memory Usage", defaultVisible: false, width: "120px", sortField: "memory_usage_mb" },
  { key: "uptime", label: "Uptime", defaultVisible: false, width: "100px", sortField: "uptime_seconds" },
  { key: "serial", label: "Serial Number", defaultVisible: true, width: "120px", sortField: "serial_number" },
  { key: "linked", label: "Linked", defaultVisible: true, width: "70px", sortField: "server_id" },
  { key: "vcenter", label: "vCenter", defaultVisible: true, width: "100px", sortField: "source_vcenter_id" },
  { key: "sync", label: "Last Sync", defaultVisible: true, width: "100px", sortField: "last_sync" },
];

export const HOST_DEFAULT_COLUMNS = HOST_COLUMNS.filter(c => c.defaultVisible !== false).map(c => c.key);

// ============= VM COLUMNS =============
export const VM_COLUMNS: ColumnDefinition[] = [
  { key: "name", label: "VM Name", defaultVisible: true, width: "180px", sortField: "name" },
  { key: "power", label: "Power", defaultVisible: true, width: "80px", sortField: "power_state" },
  { key: "status", label: "Status", defaultVisible: false, width: "80px", sortField: "overall_status" },
  { key: "ip", label: "IP Address", defaultVisible: true, width: "110px", sortField: "ip_address" },
  { key: "resources", label: "CPU/RAM", defaultVisible: true, width: "100px" },
  { key: "disk", label: "Disk", defaultVisible: true, width: "60px", sortField: "disk_gb" },
  { key: "os", label: "Guest OS", defaultVisible: true, width: "140px", sortField: "guest_os" },
  { key: "tools", label: "VMware Tools", defaultVisible: true, width: "80px", sortField: "tools_status" },
  { key: "cluster", label: "Cluster", defaultVisible: true, width: "100px", sortField: "cluster_name" },
  { key: "hwVersion", label: "HW Version", defaultVisible: false, width: "90px", sortField: "hardware_version" },
  { key: "folder", label: "Folder", defaultVisible: false, width: "120px", sortField: "folder_path" },
  { key: "resourcePool", label: "Resource Pool", defaultVisible: false, width: "120px", sortField: "resource_pool" },
  { key: "snapshots", label: "Snapshots", defaultVisible: false, width: "80px", sortField: "snapshot_count" },
  { key: "template", label: "Template", defaultVisible: false, width: "80px", sortField: "is_template" },
  { key: "notes", label: "Notes", defaultVisible: false, width: "150px", sortField: "notes" },
  { key: "datastore", label: "Datastore", defaultVisible: false, width: "120px", sortField: "primary_datastore" },
  { key: "sync", label: "Last Sync", defaultVisible: false, width: "100px", sortField: "last_sync" },
];

export const VM_DEFAULT_COLUMNS = VM_COLUMNS.filter(c => c.defaultVisible !== false).map(c => c.key);

// ============= DATASTORE COLUMNS =============
export const DATASTORE_COLUMNS: ColumnDefinition[] = [
  { key: "name", label: "Name", defaultVisible: true, width: "250px", sortField: "name" },
  { key: "type", label: "Type", defaultVisible: true, width: "100px", sortField: "type" },
  { key: "capacity", label: "Capacity", defaultVisible: true, width: "120px", sortField: "capacity_bytes" },
  { key: "free", label: "Free", defaultVisible: true, width: "120px", sortField: "free_bytes" },
  { key: "usage", label: "Usage", defaultVisible: true, width: "200px", sortField: "usage" },
  { key: "hosts", label: "Hosts", defaultVisible: true, width: "80px", sortField: "host_count" },
  { key: "vms", label: "VMs", defaultVisible: true, width: "80px", sortField: "vm_count" },
  { key: "status", label: "Status", defaultVisible: true, width: "100px", sortField: "accessible" },
  { key: "maintenance", label: "Maintenance", defaultVisible: false, width: "100px", sortField: "maintenance_mode" },
  { key: "vcenter", label: "vCenter", defaultVisible: false, width: "120px", sortField: "source_vcenter_id" },
  { key: "sync", label: "Last Sync", defaultVisible: false, width: "100px", sortField: "last_sync" },
];

export const DATASTORE_DEFAULT_COLUMNS = DATASTORE_COLUMNS.filter(c => c.defaultVisible !== false).map(c => c.key);

// ============= NETWORK COLUMNS =============
export const NETWORK_COLUMNS: ColumnDefinition[] = [
  { key: "name", label: "Name", defaultVisible: true, width: "200px", sortField: "name" },
  { key: "type", label: "Type", defaultVisible: true, width: "100px", sortField: "network_type" },
  { key: "vlan", label: "VLAN", defaultVisible: true, width: "100px", sortField: "vlan_id" },
  { key: "vlanType", label: "VLAN Type", defaultVisible: false, width: "100px", sortField: "vlan_type" },
  { key: "vlanRange", label: "VLAN Range", defaultVisible: false, width: "120px", sortField: "vlan_range" },
  { key: "switch", label: "Parent Switch", defaultVisible: false, width: "150px", sortField: "parent_switch_name" },
  { key: "sites", label: "Sites", defaultVisible: true, width: "100px", sortField: "site_count" },
  { key: "hosts", label: "Hosts", defaultVisible: true, width: "80px", sortField: "host_count" },
  { key: "vms", label: "VMs", defaultVisible: true, width: "80px", sortField: "vm_count" },
  { key: "accessible", label: "Accessible", defaultVisible: false, width: "90px", sortField: "accessible" },
  { key: "uplink", label: "Uplink", defaultVisible: false, width: "80px", sortField: "uplink_port_group" },
  { key: "vcenter", label: "vCenter", defaultVisible: false, width: "120px", sortField: "source_vcenter_id" },
];

export const NETWORK_DEFAULT_COLUMNS = NETWORK_COLUMNS.filter(c => c.defaultVisible !== false).map(c => c.key);

// ============= FILTER OPTIONS =============
export const DRS_AUTOMATION_LEVELS = [
  { value: "all", label: "All DRS Levels" },
  { value: "fullyAutomated", label: "Fully Automated" },
  { value: "partiallyAutomated", label: "Partially Automated" },
  { value: "manual", label: "Manual" },
];

export const ESXI_VERSION_FILTERS = [
  { value: "all", label: "All Versions" },
  { value: "8", label: "ESXi 8.x" },
  { value: "7", label: "ESXi 7.x" },
  { value: "6", label: "ESXi 6.x" },
];

export const VM_TEMPLATE_FILTERS = [
  { value: "all", label: "All" },
  { value: "vms", label: "VMs Only" },
  { value: "templates", label: "Templates Only" },
];

export const VM_SNAPSHOT_FILTERS = [
  { value: "all", label: "All" },
  { value: "with", label: "With Snapshots" },
  { value: "without", label: "No Snapshots" },
];

export const VM_STATUS_FILTERS = [
  { value: "all", label: "All Status" },
  { value: "green", label: "Green" },
  { value: "yellow", label: "Yellow" },
  { value: "red", label: "Red" },
];

export const MAINTENANCE_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "maintenance", label: "In Maintenance" },
];

export const NETWORK_TYPE_FILTERS = [
  { value: "all", label: "All Types" },
  { value: "distributed", label: "Distributed" },
  { value: "standard", label: "Standard" },
  { value: "opaque", label: "Opaque/NSX" },
];

export const ACCESSIBLE_FILTERS = [
  { value: "all", label: "All" },
  { value: "accessible", label: "Accessible" },
  { value: "inaccessible", label: "Not Accessible" },
];

export const HAS_VMS_FILTERS = [
  { value: "all", label: "All" },
  { value: "inUse", label: "In Use" },
  { value: "unused", label: "Unused" },
];
