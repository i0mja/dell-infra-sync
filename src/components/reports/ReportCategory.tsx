import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReportChart } from "./ReportChart";
import { ReportTable } from "./ReportTable";
import { useReports } from "@/hooks/useReports";
import { ReportType, REPORTS } from "@/config/reports-config";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { Loader2, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ReportCategoryProps {
  reportType: ReportType;
  dateRange: { from: Date; to: Date };
}

export function ReportCategory({ reportType, dateRange }: ReportCategoryProps) {
  const report = REPORTS[reportType];

  const { data, isLoading, error } = useReports(reportType, {
    start: dateRange.from,
    end: dateRange.to,
  });

  const handleExport = () => {
    if (!data?.rows) return;

    const columns = getExportColumns(reportType);
    exportToCSV(data.rows, columns, `${report.id}_report`);
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Error Loading Report</CardTitle>
          <CardDescription>{(error as Error).message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <report.icon className="h-5 w-5" />
              {report.name}
            </CardTitle>
            <CardDescription>{report.description}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Stats */}
            {data?.summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(data.summary).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <p className="text-sm text-muted-foreground capitalize">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </p>
                    <p className="text-2xl font-bold">{value as React.ReactNode}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Chart */}
            {data?.chartData && data.chartData.length > 0 && (
              <ReportChart type={report.chartType} data={data.chartData} />
            )}

            {/* Data Table */}
            {data?.rows && (
              <ReportTable data={data.rows} columns={getTableColumns(reportType)} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getTableColumns(reportType: ReportType) {
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
        { 
          key: "ha_enabled", 
          label: "HA",
          format: (value: boolean) => value ? "✓" : "✗"
        },
        { 
          key: "drs_enabled", 
          label: "DRS",
          format: (value: boolean) => value ? "✓" : "✗"
        },
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
        { 
          key: "credential_set_id", 
          label: "Credentials",
          format: (value: string) => value ? "✓" : "✗"
        },
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

    // ============= NEW UPDATE REPORTS =============

    case "update_history":
      return [
        { key: "server", label: "Server/Host" },
        { key: "job_type_label", label: "Update Type" },
        { key: "component", label: "Component" },
        { key: "version_before", label: "Previous Version" },
        { key: "version_after", label: "New Version" },
        { 
          key: "status", 
          label: "Result",
          format: (value: string) => (
            <Badge variant={value === "completed" ? "default" : value === "failed" ? "destructive" : "secondary"}>
              {value === "completed" ? "Success" : value === "failed" ? "Failed" : value}
            </Badge>
          )
        },
        { key: "initiated_by", label: "Initiated By" },
        { key: "started_at", label: "Started", format: (value: string) => value ? new Date(value).toLocaleString() : "-" },
        { 
          key: "duration_ms", 
          label: "Duration",
          format: (value: number) => value ? `${Math.round(value / 1000)}s` : "-"
        },
      ];

    case "update_failures":
      return [
        { key: "server", label: "Server" },
        { key: "server_ip", label: "IP Address" },
        { key: "job_type_label", label: "Update Type" },
        { key: "error", label: "Error Message" },
        { key: "attempted_at", label: "Attempted", format: (value: string) => value ? new Date(value).toLocaleString() : "-" },
        { 
          key: "duration_ms", 
          label: "Duration",
          format: (value: number) => value ? `${Math.round(value / 1000)}s` : "-"
        },
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
              value === "Critical (>90d)" ? "destructive" : 
              "outline"
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
            <Badge variant={
              value === "Compliant" ? "default" : 
              value === "Non-compliant" ? "destructive" : 
              "secondary"
            }>
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
              value === "Very Old (>90d)" ? "destructive" : 
              "outline"
            }>
              {value}
            </Badge>
          )
        },
        { key: "backup_name", label: "Backup Name" },
        { key: "last_backup", label: "Last Backup", format: (value: string) => value ? new Date(value).toLocaleString() : "Never" },
        { key: "days_since_backup", label: "Days Ago", format: (value: number) => value !== null ? value : "-" },
      ];

    default:
      return [];
  }
}

function getExportColumns(reportType: ReportType): ExportColumn<any>[] {
  const columns = getTableColumns(reportType);
  return columns.map(col => ({
    key: col.key,
    label: col.label,
    format: col.format ? (value, row) => {
      const result = col.format!(value, row);
      return typeof result === "string" ? result : String(value ?? "");
    } : undefined,
  }));
}
