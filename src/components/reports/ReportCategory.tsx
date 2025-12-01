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

  // Convert dateRange format for useReports hook
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
      return typeof result === "string" ? result : String(value);
    } : undefined,
  }));
}
