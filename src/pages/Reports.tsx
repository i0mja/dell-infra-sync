import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReportsFilterToolbar } from "@/components/reports/ReportsFilterToolbar";
import { ReportSummaryBar } from "@/components/reports/ReportSummaryBar";
import { ReportTable, ReportColumn } from "@/components/reports/ReportTable";
import { UpdateDetailDialog } from "@/components/reports/UpdateDetailDialog";
import { ReportsPageHeader } from "@/components/reports/ReportsPageHeader";
import { REPORT_CATEGORIES, getReportsByCategory, ReportCategory, ReportType, REPORTS } from "@/config/reports-config";
import { useReports } from "@/hooks/useReports";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { subDays, startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { FileBarChart } from "lucide-react";

// Get date range from preset string
function getDateRangeFromPreset(preset: string): { from: Date; to: Date } {
  const now = new Date();
  switch (preset) {
    case "7d":
      return { from: subDays(now, 7), to: now };
    case "30d":
      return { from: subDays(now, 30), to: now };
    case "90d":
      return { from: subDays(now, 90), to: now };
    case "this_month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "last_month": {
      const lastMonth = subMonths(now, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    }
    case "all":
    default:
      return { from: new Date(2020, 0, 1), to: now };
  }
}

// Table column definitions for each report type
function getTableColumns(reportType: ReportType): ReportColumn[] {
  switch (reportType) {
    case "server_inventory":
      return [
        { key: "hostname", label: "Hostname" },
        { key: "ip_address", label: "IP Address" },
        { key: "model", label: "Model" },
        { 
          key: "connection_status", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={value === "online" ? "default" : "secondary"}>
              {value || "unknown"}
            </Badge>
          )
        },
        { key: "bios_version", label: "BIOS" },
      ];

    case "cluster_summary":
      return [
        { key: "cluster_name", label: "Cluster" },
        { key: "host_count", label: "Hosts" },
        { key: "vm_count", label: "VMs" },
        { key: "ha_enabled", label: "HA", format: (value: boolean) => value ? "✓" : "✗" },
        { key: "drs_enabled", label: "DRS", format: (value: boolean) => value ? "✓" : "✗" },
      ];

    case "job_summary":
      return [
        { key: "job_type", label: "Job Type" },
        { 
          key: "status", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={value === "completed" ? "default" : value === "failed" ? "destructive" : "secondary"}>
              {value}
            </Badge>
          )
        },
        { key: "created_at", label: "Created", format: (value: string) => new Date(value).toLocaleString() },
        { key: "completed_at", label: "Completed", format: (value: string) => value ? new Date(value).toLocaleString() : "-" },
      ];

    case "api_activity":
      return [
        { key: "command_type", label: "Command" },
        { key: "endpoint", label: "Endpoint" },
        { 
          key: "success", 
          label: "Status",
          format: (value: boolean) => (
            <Badge variant={value ? "default" : "destructive"}>
              {value ? "Success" : "Failed"}
            </Badge>
          )
        },
        { key: "response_time_ms", label: "Time (ms)" },
        { key: "timestamp", label: "Timestamp", format: (value: string) => new Date(value).toLocaleString() },
      ];

    case "firmware_status":
      return [
        { key: "hostname", label: "Hostname" },
        { key: "model", label: "Model" },
        { key: "bios_version", label: "BIOS Version" },
        { key: "idrac_firmware", label: "iDRAC Version" },
        { key: "redfish_version", label: "Redfish Version" },
        { 
          key: "connection_status", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={value === "online" ? "default" : "secondary"}>
              {value || "unknown"}
            </Badge>
          )
        },
        { key: "last_seen", label: "Last Seen", format: (value: string) => value ? new Date(value).toLocaleString() : "-" },
      ];

    case "credential_coverage":
      return [
        { key: "hostname", label: "Hostname" },
        { key: "ip_address", label: "IP Address" },
        { key: "credential_set_id", label: "Credentials", format: (value: string) => value ? "✓" : "✗" },
        { 
          key: "connection_status", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={value === "online" ? "default" : "secondary"}>
              {value || "unknown"}
            </Badge>
          )
        },
      ];

    case "maintenance_history":
      return [
        { key: "title", label: "Maintenance Window" },
        { key: "maintenance_type", label: "Type" },
        { 
          key: "status", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={value === "completed" ? "default" : value === "in_progress" ? "secondary" : "outline"}>
              {value}
            </Badge>
          )
        },
        { key: "planned_start", label: "Planned Start", format: (value: string) => new Date(value).toLocaleString() },
        { key: "planned_end", label: "Planned End", format: (value: string) => new Date(value).toLocaleString() },
      ];

    case "cluster_safety":
      return [
        { key: "cluster_id", label: "Cluster ID" },
        { 
          key: "safe_to_proceed", 
          label: "Safe",
          format: (value: boolean) => (
            <Badge variant={value ? "default" : "destructive"}>
              {value ? "Safe" : "Unsafe"}
            </Badge>
          )
        },
        { key: "total_hosts", label: "Total Hosts" },
        { key: "healthy_hosts", label: "Healthy Hosts" },
        { key: "min_required_hosts", label: "Min Required" },
        { key: "check_timestamp", label: "Check Time", format: (value: string) => new Date(value).toLocaleString() },
      ];

    case "update_scans":
      return [
        { 
          key: "scan_date", 
          label: "Scan Date", 
          format: (value: string) => value ? format(new Date(value), "MMM d, yyyy HH:mm") : "-"
        },
        { key: "scan_type", label: "Type" },
        { key: "hosts_scanned", label: "Hosts" },
        { key: "updates_available", label: "Updates" },
        { key: "critical_updates", label: "Critical" },
        { 
          key: "status", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={value === "completed" ? "default" : value === "failed" ? "destructive" : "secondary"}>
              {value}
            </Badge>
          )
        },
      ];

    case "update_history":
      return [
        { key: "server", label: "Server" },
        { key: "cluster_name", label: "Cluster" },
        { 
          key: "status", 
          label: "Result",
          format: (value: string) => (
            <Badge variant={value === "completed" ? "default" : value === "failed" ? "destructive" : "secondary"}>
              {value === "completed" ? "Success" : value === "failed" ? "Failed" : value}
            </Badge>
          )
        },
        { 
          key: "components_updated", 
          label: "Components",
          format: (value: number) => value ? `${value} updated` : "-"
        },
        { 
          key: "started_at", 
          label: "Date", 
          format: (value: string) => value ? format(new Date(value), "MMM d, yyyy") : "-" 
        },
      ];

    case "update_failures":
      return [
        { key: "server", label: "Server" },
        { key: "server_ip", label: "IP Address" },
        { key: "job_type_label", label: "Update Type" },
        { key: "error", label: "Error Message" },
        { key: "attempted_at", label: "Attempted", format: (value: string) => value ? new Date(value).toLocaleString() : "-" },
        { key: "duration_ms", label: "Duration", format: (value: number) => value ? `${Math.round(value / 1000)}s` : "-" },
      ];

    case "server_update_coverage":
      return [
        { key: "server", label: "Server" },
        { key: "ip_address", label: "IP Address" },
        { key: "model", label: "Model" },
        { 
          key: "coverage_status", 
          label: "Coverage",
          format: (value: string) => (
            <Badge variant={
              value === "Current (<30d)" ? "default" : 
              value === "Stale (30-90d)" ? "secondary" : 
              value === "Critical (>90d)" ? "destructive" : "outline"
            }>
              {value}
            </Badge>
          )
        },
        { key: "last_update", label: "Last Update", format: (value: string) => value ? new Date(value).toLocaleString() : "Never" },
        { key: "days_since_update", label: "Days Ago", format: (value: number) => value !== null ? value : "-" },
      ];

    case "component_compliance":
      return [
        { key: "server", label: "Server" },
        { key: "component", label: "Component" },
        { key: "component_type", label: "Type" },
        { key: "current_version", label: "Current Version" },
        { key: "baseline_version", label: "Baseline" },
        { 
          key: "compliant", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={value === "Compliant" ? "default" : value === "Non-compliant" ? "destructive" : "secondary"}>
              {value}
            </Badge>
          )
        },
      ];

    case "esxi_upgrade_history":
      return [
        { key: "host", label: "Host" },
        { key: "cluster", label: "Cluster" },
        { key: "version_before", label: "From Version" },
        { key: "version_after", label: "To Version" },
        { 
          key: "status", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={value === "completed" ? "default" : value === "failed" ? "destructive" : "secondary"}>
              {value}
            </Badge>
          )
        },
        { key: "started_at", label: "Started", format: (value: string) => value ? new Date(value).toLocaleString() : "-" },
        { key: "completed_at", label: "Completed", format: (value: string) => value ? new Date(value).toLocaleString() : "-" },
      ];

    case "scp_backup_status":
      return [
        { key: "server", label: "Server" },
        { key: "ip_address", label: "IP Address" },
        { key: "model", label: "Model" },
        { 
          key: "backup_status", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={
              value === "Recent (<30d)" ? "default" : 
              value === "Stale (30-90d)" ? "secondary" : 
              value === "Very Old (>90d)" ? "destructive" : "outline"
            }>
              {value}
            </Badge>
          )
        },
        { key: "backup_name", label: "Backup Name" },
        { key: "last_backup", label: "Last Backup", format: (value: string) => value ? new Date(value).toLocaleString() : "Never" },
        { key: "days_since_backup", label: "Days Ago", format: (value: number) => value !== null ? value : "-" },
      ];

    case "backup_history":
      return [
        { key: "server", label: "Server" },
        { key: "ip_address", label: "IP Address" },
        { key: "backup_name", label: "Backup Name" },
        { key: "components", label: "Components" },
        { key: "file_size", label: "Size", format: (value: number) => value ? formatFileSize(value) : "-" },
        { key: "is_valid", label: "Valid", format: (value: boolean) => value ? "✓" : "✗" },
        { key: "exported_at", label: "Exported", format: (value: string) => value ? new Date(value).toLocaleString() : "-" },
      ];

    case "backup_coverage":
      return [
        { key: "server", label: "Server" },
        { key: "ip_address", label: "IP Address" },
        { key: "model", label: "Model" },
        { 
          key: "coverage_status", 
          label: "Status",
          format: (value: string) => (
            <Badge variant={value === "Critical" ? "destructive" : value === "Warning" ? "secondary" : "default"}>
              {value}
            </Badge>
          )
        },
        { key: "days_since_backup", label: "Days Ago", format: (value: number) => value !== null ? value : "Never" },
        { key: "action_needed", label: "Action Needed" },
      ];

    default:
      return [];
  }
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [selectedReportType, setSelectedReportType] = useState<ReportType | null>(null);
  const [dateRangePreset, setDateRangePreset] = useState("30d");
  const [searchTerm, setSearchTerm] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [selectedUpdate, setSelectedUpdate] = useState<any | null>(null);

  // Read category from URL, default to "inventory"
  const categoryFromUrl = searchParams.get('category') as ReportCategory | null;
  const activeCategory = categoryFromUrl && REPORT_CATEGORIES.some(c => c.id === categoryFromUrl) 
    ? categoryFromUrl 
    : "inventory";

  // Get current category config
  const currentCategoryConfig = REPORT_CATEGORIES.find(c => c.id === activeCategory);

  // Get reports for the active category
  const categoryReports = useMemo(() => getReportsByCategory(activeCategory), [activeCategory]);

  // Auto-select first report when category changes
  const currentReportType = useMemo(() => {
    if (selectedReportType && categoryReports.some((r) => r.id === selectedReportType)) {
      return selectedReportType;
    }
    return categoryReports[0]?.id || null;
  }, [selectedReportType, categoryReports]);

  // Reset selected report when category changes via URL
  useEffect(() => {
    setSelectedReportType(null);
    setVisibleColumns([]);
    setSearchTerm("");
  }, [activeCategory]);

  // Get date range from preset
  const dateRange = useMemo(() => getDateRangeFromPreset(dateRangePreset), [dateRangePreset]);

  // Fetch report data
  const { data, isLoading, error } = useReports(currentReportType as ReportType, {
    start: dateRange.from,
    end: dateRange.to,
  });

  // Get columns for the current report
  const columns = useMemo(() => {
    if (!currentReportType) return [];
    return getTableColumns(currentReportType);
  }, [currentReportType]);

  // Initialize visible columns when report changes
  useMemo(() => {
    if (columns.length > 0 && visibleColumns.length === 0) {
      setVisibleColumns(columns.map((c) => c.key));
    }
  }, [columns]);

  // Handle category change - update URL
  const handleCategoryChange = (category: string) => {
    if (category === "inventory") {
      searchParams.delete('category');
    } else {
      searchParams.set('category', category);
    }
    setSearchParams(searchParams);
  };

  // Handle report type change
  const handleReportTypeChange = useCallback((reportType: ReportType) => {
    setSelectedReportType(reportType);
    setVisibleColumns([]);
    setSearchTerm("");
  }, []);

  // Toggle column visibility
  const handleToggleColumn = useCallback((columnKey: string) => {
    setVisibleColumns((prev) => {
      if (prev.includes(columnKey)) {
        return prev.filter((k) => k !== columnKey);
      }
      return [...prev, columnKey];
    });
  }, []);

  // Export to CSV
  const handleExport = useCallback(() => {
    if (!data?.rows || !currentReportType) return;

    const report = REPORTS[currentReportType];
    const exportColumns: ExportColumn<any>[] = columns
      .filter((col) => visibleColumns.includes(col.key))
      .map((col) => ({
        key: col.key,
        label: col.label,
        format: col.format
          ? (value: any, row: any) => {
              const result = col.format!(value, row);
              return typeof result === "string" ? result : String(value ?? "");
            }
          : undefined,
      }));

    exportToCSV(data.rows, exportColumns, `${report.id}_report`);
  }, [data, currentReportType, columns, visibleColumns]);

  // Handle row click for navigable reports
  const handleRowClick = useCallback((row: any) => {
    if (currentReportType === "update_scans" && row.id) {
      navigate(`/reports/updates/${row.id}`);
    } else if (currentReportType === "update_history") {
      setSelectedUpdate(row);
    }
  }, [currentReportType, navigate]);

  // Current visible columns for filter
  const currentVisibleColumns = visibleColumns.length > 0 ? visibleColumns : columns.map((c) => c.key);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ReportsPageHeader
        icon={currentCategoryConfig?.icon || FileBarChart}
        title={currentCategoryConfig?.label || "Reports"}
        description={`View ${currentCategoryConfig?.label.toLowerCase() || 'all'} reports and analytics`}
        recordCount={data?.rows?.length}
      />
      
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Horizontal Category Tabs */}
        <div className="flex items-center gap-2 border-b pb-3">
          {REPORT_CATEGORIES.map((category) => {
            const Icon = category.icon;
            const isActive = activeCategory === category.id;
            return (
              <Button
                key={category.id}
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "transition-all",
                  isActive && "bg-secondary font-medium"
                )}
                onClick={() => handleCategoryChange(category.id)}
              >
                <Icon className="h-4 w-4 mr-2" />
                {category.label}
              </Button>
            );
          })}
        </div>

        {/* Report Content */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <ReportsFilterToolbar
              reportTypes={categoryReports}
              selectedReportType={currentReportType}
              onReportTypeChange={handleReportTypeChange}
              dateRange={dateRangePreset}
              onDateRangeChange={setDateRangePreset}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              visibleColumns={currentVisibleColumns}
              allColumns={columns}
              onToggleColumn={handleToggleColumn}
              onExport={handleExport}
            />

            <ReportSummaryBar summary={data?.summary} isLoading={isLoading} />

            {error ? (
              <div className="flex items-center justify-center h-48 text-destructive">
                Error loading report: {(error as Error).message}
              </div>
            ) : (
              <ReportTable
                data={data?.rows || []}
                columns={columns}
                visibleColumns={currentVisibleColumns}
                isLoading={isLoading}
                searchTerm={searchTerm}
                onRowClick={(currentReportType === "update_scans" || currentReportType === "update_history") ? handleRowClick : undefined}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <UpdateDetailDialog
        open={!!selectedUpdate}
        onOpenChange={(open) => !open && setSelectedUpdate(null)}
        update={selectedUpdate}
      />
    </div>
  );
}
