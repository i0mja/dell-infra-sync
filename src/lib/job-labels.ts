import {
  Search,
  RefreshCw,
  Server,
  Power,
  HardDrive,
  Settings,
  Download,
  Upload,
  Shield,
  Network,
  MonitorCheck,
  Cpu,
  Database,
  Trash2,
  FileText,
  Zap,
  Clock,
  AlertTriangle,
  LucideIcon,
} from "lucide-react";

export interface JobLabelInfo {
  label: string;
  icon: LucideIcon;
  description?: string;
}

export const JOB_LABELS: Record<string, JobLabelInfo> = {
  // Discovery & Sync
  discovery: { label: "Server Discovery", icon: Search, description: "Scanning network for servers" },
  vcenter_sync: { label: "vCenter Sync", icon: RefreshCw, description: "Syncing vCenter inventory" },
  openmanage_sync: { label: "OpenManage Sync", icon: Database, description: "Syncing OpenManage data" },
  
  // Power Operations
  power_on: { label: "Power On", icon: Power, description: "Powering on server" },
  power_off: { label: "Power Off", icon: Power, description: "Powering off server" },
  power_cycle: { label: "Power Cycle", icon: RefreshCw, description: "Cycling server power" },
  graceful_shutdown: { label: "Graceful Shutdown", icon: Power, description: "Gracefully shutting down" },
  graceful_restart: { label: "Graceful Restart", icon: RefreshCw, description: "Gracefully restarting" },
  force_restart: { label: "Force Restart", icon: Power, description: "Force restarting server" },
  
  // Firmware
  firmware_update: { label: "Firmware Update", icon: Download, description: "Updating firmware" },
  firmware_inventory: { label: "Firmware Inventory", icon: FileText, description: "Collecting firmware info" },
  
  // BIOS & Configuration
  bios_configure: { label: "BIOS Configure", icon: Settings, description: "Configuring BIOS settings" },
  bios_snapshot: { label: "BIOS Snapshot", icon: FileText, description: "Capturing BIOS config" },
  scp_export: { label: "SCP Export", icon: Download, description: "Exporting server config" },
  scp_import: { label: "SCP Import", icon: Upload, description: "Importing server config" },
  scp_restore: { label: "SCP Restore", icon: Upload, description: "Restoring server config" },
  
  // Virtual Media
  virtual_media_mount: { label: "Mount ISO", icon: HardDrive, description: "Mounting virtual media" },
  virtual_media_unmount: { label: "Unmount ISO", icon: HardDrive, description: "Unmounting virtual media" },
  
  // iDRAC
  idrac_reset: { label: "iDRAC Reset", icon: RefreshCw, description: "Resetting iDRAC" },
  idrac_configure: { label: "iDRAC Configure", icon: Settings, description: "Configuring iDRAC" },
  
  // Monitoring & Health
  health_check: { label: "Health Check", icon: MonitorCheck, description: "Checking server health" },
  refresh_inventory: { label: "Refresh Inventory", icon: RefreshCw, description: "Refreshing inventory" },
  system_info_refresh: { label: "System Info Refresh", icon: Server, description: "Refreshing system info" },
  
  // Lifecycle
  lifecycle_refresh: { label: "Lifecycle Refresh", icon: Cpu, description: "Refreshing lifecycle data" },
  clear_lifecycle_logs: { label: "Clear Logs", icon: Trash2, description: "Clearing lifecycle logs" },
  
  // Security
  ssl_certificate: { label: "SSL Certificate", icon: Shield, description: "Managing SSL certificate" },
  
  // Network
  network_configure: { label: "Network Configure", icon: Network, description: "Configuring network" },
  
  // ESXi
  esxi_upgrade: { label: "ESXi Upgrade", icon: Upload, description: "Upgrading ESXi" },
  esxi_maintenance: { label: "ESXi Maintenance", icon: Settings, description: "ESXi maintenance mode" },
  
  // Replication
  replication_sync: { label: "Replication Sync", icon: RefreshCw, description: "Syncing replication" },
  failover_test: { label: "Failover Test", icon: AlertTriangle, description: "Testing failover" },
  failover_execute: { label: "Execute Failover", icon: Zap, description: "Executing failover" },
  
  // SLA Monitoring
  cluster_health_check: { label: "Cluster Health", icon: MonitorCheck, description: "Checking cluster health" },
  sla_cluster_safety: { label: "SLA Safety Check", icon: Shield, description: "SLA safety check" },
  
  // Scheduled
  scheduled_job: { label: "Scheduled Job", icon: Clock, description: "Running scheduled job" },
};

export function getJobLabel(jobType: string): JobLabelInfo {
  return JOB_LABELS[jobType] || { 
    label: jobType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    icon: Zap,
    description: `Executing ${jobType}`
  };
}

export function getTargetScopeLabel(targetScope: any): string {
  if (!targetScope) return "No target";
  
  if (targetScope.server_ids?.length) {
    const count = targetScope.server_ids.length;
    return count === 1 ? "1 server" : `${count} servers`;
  }
  
  if (targetScope.server_id) {
    return targetScope.server_name || "1 server";
  }
  
  if (targetScope.vcenter_ids?.length) {
    const count = targetScope.vcenter_ids.length;
    return count === 1 ? "1 vCenter" : `${count} vCenters`;
  }
  
  if (targetScope.cluster_id) {
    return targetScope.cluster_name || "1 cluster";
  }
  
  if (targetScope.all_servers) {
    return "All servers";
  }
  
  if (targetScope.ip_range) {
    return targetScope.ip_range;
  }
  
  return "Custom scope";
}
