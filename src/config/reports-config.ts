import { BarChart3, Activity, Database, Shield } from "lucide-react";

export type ReportCategory = "inventory" | "operations" | "compliance" | "maintenance" | "audit";
export type ReportType = 
  | "server_inventory" 
  | "cluster_summary"
  | "job_summary"
  | "api_activity"
  | "firmware_status"
  | "credential_coverage"
  | "maintenance_history"
  | "cluster_safety";

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
