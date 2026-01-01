import { FileBarChart, RefreshCw, History, Shield } from "lucide-react";

export interface ReportNavigationItem {
  name: string;
  href: string;
  icon: typeof FileBarChart;
  description?: string;
}

export const getReportsNavigation = (): ReportNavigationItem[] => [
  { name: "All Reports", href: "/reports", icon: FileBarChart, description: "View all report types" },
  { name: "Update Reports", href: "/reports?category=updates", icon: RefreshCw, description: "Firmware and update reports" },
  { name: "Audit History", href: "/reports?category=audit", icon: History, description: "Activity and audit logs" },
  { name: "Compliance", href: "/reports?category=compliance", icon: Shield, description: "Compliance and backup reports" },
];
