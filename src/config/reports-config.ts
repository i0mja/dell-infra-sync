import { BarChart3, Activity, Database, Shield, RefreshCw, Archive, Lock } from "lucide-react";

export type ReportCategory = "inventory" | "operations" | "compliance" | "maintenance" | "updates" | "backups" | "security";
export type ReportType = 
  | "server_inventory" 
  | "cluster_summary"
  | "job_summary"
  | "api_activity"
  | "firmware_status"
  | "credential_coverage"
  | "maintenance_history"
  | "cluster_safety"
  // Update reports
  | "update_scans"
  | "update_history"
  | "update_failures"
  | "server_update_coverage"
  | "component_compliance"
  | "esxi_upgrade_history"
  // Backup reports
  | "scp_backup_status"
  | "backup_history"
  | "backup_coverage"
  // SSH Key reports
  | "ssh_key_inventory"
  | "ssh_key_expiring"
  | "ssh_key_unused"
  | "ssh_key_revocation"
  | "ssh_key_usage";

export interface ReportConfig {
  id: ReportType;
  name: string;
  description: string;
  category: ReportCategory;
  icon: any;
  chartType: "bar" | "pie" | "line" | "area" | null;
  requiredRole: "viewer" | "operator" | "admin";
}

export const REPORT_CATEGORIES = [
  { id: "inventory", label: "Inventory", icon: Database },
  { id: "operations", label: "Operations", icon: Activity },
  { id: "compliance", label: "Compliance", icon: Shield },
  { id: "maintenance", label: "Maintenance", icon: BarChart3 },
  { id: "updates", label: "Updates", icon: RefreshCw },
  { id: "backups", label: "Backups", icon: Archive },
  { id: "security", label: "Security", icon: Lock },
] as const;

export const REPORTS: Record<ReportType, ReportConfig> = {
  server_inventory: {
    id: "server_inventory",
    name: "Server Inventory",
    description: "Complete list of all servers with hardware details",
    category: "inventory",
    icon: Database,
    chartType: "bar",
    requiredRole: "viewer",
  },
  cluster_summary: {
    id: "cluster_summary",
    name: "Cluster Summary",
    description: "vCenter cluster statistics and resource utilization",
    category: "inventory",
    icon: Database,
    chartType: "pie",
    requiredRole: "viewer",
  },
  job_summary: {
    id: "job_summary",
    name: "Job Summary",
    description: "Job execution history and status breakdown",
    category: "operations",
    icon: Activity,
    chartType: "line",
    requiredRole: "viewer",
  },
  api_activity: {
    id: "api_activity",
    name: "API Activity",
    description: "iDRAC API call statistics and success rates",
    category: "operations",
    icon: Activity,
    chartType: "area",
    requiredRole: "operator",
  },
  firmware_status: {
    id: "firmware_status",
    name: "Firmware Status",
    description: "Server firmware versions and compliance status",
    category: "compliance",
    icon: Shield,
    chartType: "pie",
    requiredRole: "viewer",
  },
  credential_coverage: {
    id: "credential_coverage",
    name: "Credential Coverage",
    description: "Servers with assigned credentials vs unconfigured",
    category: "compliance",
    icon: Shield,
    chartType: "bar",
    requiredRole: "operator",
  },
  maintenance_history: {
    id: "maintenance_history",
    name: "Maintenance History",
    description: "Maintenance window execution history",
    category: "maintenance",
    icon: BarChart3,
    chartType: "line",
    requiredRole: "viewer",
  },
  cluster_safety: {
    id: "cluster_safety",
    name: "Cluster Safety",
    description: "Cluster safety check results over time",
    category: "maintenance",
    icon: BarChart3,
    chartType: "area",
    requiredRole: "viewer",
  },
  // New Update Reports
  update_scans: {
    id: "update_scans",
    name: "Update Scans",
    description: "Browse firmware update availability scan results",
    category: "updates",
    icon: RefreshCw,
    chartType: null,
    requiredRole: "viewer",
  },
  update_history: {
    id: "update_history",
    name: "Update History",
    description: "Timeline of all firmware and system updates with status",
    category: "updates",
    icon: RefreshCw,
    chartType: "line",
    requiredRole: "viewer",
  },
  update_failures: {
    id: "update_failures",
    name: "Update Failures",
    description: "Failed updates with error details and affected servers",
    category: "updates",
    icon: RefreshCw,
    chartType: "pie",
    requiredRole: "operator",
  },
  server_update_coverage: {
    id: "server_update_coverage",
    name: "Server Update Coverage",
    description: "Servers by last update date - identify stale systems",
    category: "updates",
    icon: RefreshCw,
    chartType: "pie",
    requiredRole: "viewer",
  },
  component_compliance: {
    id: "component_compliance",
    name: "Component Compliance",
    description: "Component versions compared against baseline packages",
    category: "updates",
    icon: RefreshCw,
    chartType: "bar",
    requiredRole: "operator",
  },
  esxi_upgrade_history: {
    id: "esxi_upgrade_history",
    name: "ESXi Upgrade History",
    description: "ESXi host upgrade timeline and results",
    category: "updates",
    icon: RefreshCw,
    chartType: "line",
    requiredRole: "viewer",
  },
  // Backup Reports (moved scp_backup_status to backups category)
  scp_backup_status: {
    id: "scp_backup_status",
    name: "Backup Status",
    description: "Server Configuration Profile backup coverage and freshness",
    category: "backups",
    icon: Archive,
    chartType: "pie",
    requiredRole: "viewer",
  },
  backup_history: {
    id: "backup_history",
    name: "Backup History",
    description: "Timeline of SCP backup operations with export details",
    category: "backups",
    icon: Archive,
    chartType: "line",
    requiredRole: "viewer",
  },
  backup_coverage: {
    id: "backup_coverage",
    name: "Backup Coverage",
    description: "Servers requiring backup attention - missing or stale backups",
    category: "backups",
    icon: Archive,
    chartType: "pie",
    requiredRole: "operator",
  },
  // SSH Key Reports
  ssh_key_inventory: {
    id: "ssh_key_inventory",
    name: "SSH Key Inventory",
    description: "Complete list of SSH keys with status, age, and deployment details",
    category: "security",
    icon: Lock,
    chartType: "pie",
    requiredRole: "viewer",
  },
  ssh_key_expiring: {
    id: "ssh_key_expiring",
    name: "Expiring SSH Keys",
    description: "SSH keys approaching expiration within configurable windows",
    category: "security",
    icon: Lock,
    chartType: "bar",
    requiredRole: "operator",
  },
  ssh_key_unused: {
    id: "ssh_key_unused",
    name: "Unused SSH Keys",
    description: "SSH keys not used recently - candidates for review or revocation",
    category: "security",
    icon: Lock,
    chartType: "pie",
    requiredRole: "operator",
  },
  ssh_key_revocation: {
    id: "ssh_key_revocation",
    name: "SSH Key Revocations",
    description: "History of revoked SSH keys with reasons and audit trail",
    category: "security",
    icon: Lock,
    chartType: "line",
    requiredRole: "admin",
  },
  ssh_key_usage: {
    id: "ssh_key_usage",
    name: "SSH Key Usage",
    description: "Usage frequency and patterns for SSH keys across targets",
    category: "security",
    icon: Lock,
    chartType: "bar",
    requiredRole: "viewer",
  },
};

export function getReportsByCategory(category: ReportCategory): ReportConfig[] {
  return Object.values(REPORTS).filter(r => r.category === category);
}

export function getAvailableReports(userRole: "viewer" | "operator" | "admin"): ReportConfig[] {
  const roleHierarchy = { viewer: 0, operator: 1, admin: 2 };
  return Object.values(REPORTS).filter(
    r => roleHierarchy[userRole] >= roleHierarchy[r.requiredRole]
  );
}
