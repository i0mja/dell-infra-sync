import { FileBarChart, Database, Activity, Shield, BarChart3, RefreshCw, Archive, Lock } from "lucide-react";

export interface ReportNavigationItem {
  name: string;
  href: string;
  icon: typeof FileBarChart;
  description?: string;
}

export const getReportsNavigation = (): ReportNavigationItem[] => [
  { name: "All Reports", href: "/reports", icon: FileBarChart, description: "View all report types" },
  { name: "Inventory", href: "/reports?category=inventory", icon: Database, description: "Server and cluster inventory" },
  { name: "Operations", href: "/reports?category=operations", icon: Activity, description: "Job and API activity" },
  { name: "Compliance", href: "/reports?category=compliance", icon: Shield, description: "Firmware and credential status" },
  { name: "Maintenance", href: "/reports?category=maintenance", icon: BarChart3, description: "Maintenance history and safety" },
  { name: "Updates", href: "/reports?category=updates", icon: RefreshCw, description: "Update history and coverage" },
  { name: "Backups", href: "/reports?category=backups", icon: Archive, description: "Backup status and history" },
  { name: "Security", href: "/reports?category=security", icon: Lock, description: "SSH key management" },
];
