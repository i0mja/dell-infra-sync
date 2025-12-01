import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ReportType } from "@/config/reports-config";
import { format, subDays } from "date-fns";

export interface ReportData {
  rows: any[];
  summary: Record<string, any>;
  chartData: any[];
}

export function useReports(
  reportType: ReportType,
  dateRange: { start: Date; end: Date }
) {
  return useQuery({
    queryKey: ["report", reportType, dateRange.start, dateRange.end],
    queryFn: () => fetchReportData(reportType, dateRange),
  });
}

async function fetchReportData(
  reportType: ReportType,
  dateRange: { start: Date; end: Date }
): Promise<ReportData> {
  switch (reportType) {
    case "server_inventory":
      return fetchServerInventory();
    case "cluster_summary":
      return fetchClusterSummary();
    case "job_summary":
      return fetchJobSummary(dateRange);
    case "api_activity":
      return fetchApiActivity(dateRange);
    case "firmware_status":
      return fetchFirmwareStatus();
    case "credential_coverage":
      return fetchCredentialCoverage();
    case "maintenance_history":
      return fetchMaintenanceHistory(dateRange);
    case "cluster_safety":
      return fetchClusterSafety(dateRange);
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
}

async function fetchServerInventory(): Promise<ReportData> {
  const { data: servers, error } = await supabase
    .from("servers")
    .select("*")
    .order("hostname");

  if (error) throw error;

  const rows = servers || [];
  const summary = {
    total: rows.length,
    online: rows.filter(s => s.connection_status === "online").length,
    offline: rows.filter(s => s.connection_status === "offline").length,
    withCredentials: rows.filter(s => s.credential_set_id).length,
  };

  // Chart data: servers by model
  const modelCounts = rows.reduce((acc, s) => {
    const model = s.model || "Unknown";
    acc[model] = (acc[model] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const chartData = Object.entries(modelCounts).map(([name, count]) => ({
    name,
    count,
  }));

  return { rows, summary, chartData };
}

async function fetchClusterSummary(): Promise<ReportData> {
  const { data: clusters, error } = await supabase
    .from("vcenter_clusters")
    .select("*")
    .order("cluster_name");

  if (error) throw error;

  const rows = clusters || [];
  const summary = {
    total: rows.length,
    totalHosts: rows.reduce((sum, c) => sum + (c.host_count || 0), 0),
    totalVMs: rows.reduce((sum, c) => sum + (c.vm_count || 0), 0),
    haEnabled: rows.filter(c => c.ha_enabled).length,
  };

  const chartData = rows.map(c => ({
    name: c.cluster_name,
    hosts: c.host_count || 0,
    vms: c.vm_count || 0,
  }));

  return { rows, summary, chartData };
}

async function fetchJobSummary(dateRange: { start: Date; end: Date }): Promise<ReportData> {
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .gte("created_at", dateRange.start.toISOString())
    .lte("created_at", dateRange.end.toISOString())
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = jobs || [];
  const summary = {
    total: rows.length,
    completed: rows.filter(j => j.status === "completed").length,
    failed: rows.filter(j => j.status === "failed").length,
    running: rows.filter(j => j.status === "running").length,
    pending: rows.filter(j => j.status === "pending").length,
  };

  // Chart data: jobs per day
  const jobsByDay = rows.reduce((acc, j) => {
    const day = format(new Date(j.created_at), "yyyy-MM-dd");
    if (!acc[day]) {
      acc[day] = { completed: 0, failed: 0, total: 0 };
    }
    acc[day].total++;
    if (j.status === "completed") acc[day].completed++;
    if (j.status === "failed") acc[day].failed++;
    return acc;
  }, {} as Record<string, any>);

  const chartData = Object.entries(jobsByDay)
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { rows, summary, chartData };
}

async function fetchApiActivity(dateRange: { start: Date; end: Date }): Promise<ReportData> {
  const { data: commands, error } = await supabase
    .from("idrac_commands")
    .select("*")
    .gte("timestamp", dateRange.start.toISOString())
    .lte("timestamp", dateRange.end.toISOString())
    .order("timestamp", { ascending: false });

  if (error) throw error;

  const rows = commands || [];
  const summary = {
    total: rows.length,
    successful: rows.filter(c => c.success).length,
    failed: rows.filter(c => !c.success).length,
    avgResponseTime: Math.round(
      rows.reduce((sum, c) => sum + (c.response_time_ms || 0), 0) / rows.length
    ),
  };

  // Chart data: success rate per day
  const activityByDay = rows.reduce((acc, c) => {
    const day = format(new Date(c.timestamp), "yyyy-MM-dd");
    if (!acc[day]) {
      acc[day] = { successful: 0, failed: 0 };
    }
    if (c.success) acc[day].successful++;
    else acc[day].failed++;
    return acc;
  }, {} as Record<string, any>);

  const chartData = Object.entries(activityByDay)
    .map(([date, stats]) => ({ 
      date, 
      successful: stats.successful,
      failed: stats.failed,
      total: stats.successful + stats.failed 
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { rows, summary, chartData };
}

async function fetchFirmwareStatus(): Promise<ReportData> {
  const { data: servers, error } = await supabase
    .from("servers")
    .select("hostname, model, connection_status")
    .order("hostname");

  if (error) throw error;

  const rows = servers || [];
  const summary = {
    total: rows.length,
    online: rows.filter(s => s.connection_status === "online").length,
  };

  const chartData = [
    { name: "Online", value: summary.online },
    { name: "Offline", value: summary.total - summary.online },
  ];

  return { rows, summary, chartData };
}

async function fetchCredentialCoverage(): Promise<ReportData> {
  const { data: servers, error } = await supabase
    .from("servers")
    .select("hostname, ip_address, credential_set_id, connection_status")
    .order("hostname");

  if (error) throw error;

  const rows = servers || [];
  const summary = {
    total: rows.length,
    withCredentials: rows.filter(s => s.credential_set_id).length,
    withoutCredentials: rows.filter(s => !s.credential_set_id).length,
  };

  const chartData = [
    { name: "With Credentials", count: summary.withCredentials },
    { name: "Without Credentials", count: summary.withoutCredentials },
  ];

  return { rows, summary, chartData };
}

async function fetchMaintenanceHistory(dateRange: { start: Date; end: Date }): Promise<ReportData> {
  const { data: windows, error } = await supabase
    .from("maintenance_windows")
    .select("*")
    .gte("planned_start", dateRange.start.toISOString())
    .lte("planned_start", dateRange.end.toISOString())
    .order("planned_start", { ascending: false });

  if (error) throw error;

  const rows = windows || [];
  const summary = {
    total: rows.length,
    completed: rows.filter(w => w.status === "completed").length,
    planned: rows.filter(w => w.status === "planned").length,
    inProgress: rows.filter(w => w.status === "in_progress").length,
  };

  const chartData = rows
    .map(w => ({
      date: format(new Date(w.planned_start), "yyyy-MM-dd"),
      status: w.status,
      title: w.title,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { rows, summary, chartData };
}

async function fetchClusterSafety(dateRange: { start: Date; end: Date }): Promise<ReportData> {
  const { data: checks, error } = await supabase
    .from("cluster_safety_checks")
    .select("*")
    .gte("check_timestamp", dateRange.start.toISOString())
    .lte("check_timestamp", dateRange.end.toISOString())
    .order("check_timestamp", { ascending: false });

  if (error) throw error;

  const rows = checks || [];
  const summary = {
    total: rows.length,
    safe: rows.filter(c => c.safe_to_proceed).length,
    unsafe: rows.filter(c => !c.safe_to_proceed).length,
  };

  const chartData = rows
    .map(c => ({
      date: format(new Date(c.check_timestamp || c.created_at), "yyyy-MM-dd"),
      safe: c.safe_to_proceed ? 1 : 0,
      unsafe: c.safe_to_proceed ? 0 : 1,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { rows, summary, chartData };
}
