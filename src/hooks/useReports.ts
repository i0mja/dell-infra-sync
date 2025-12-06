import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ReportType } from "@/config/reports-config";
import { format, differenceInDays } from "date-fns";

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
    // New update reports
    case "update_history":
      return fetchUpdateHistory(dateRange);
    case "update_failures":
      return fetchUpdateFailures(dateRange);
    case "server_update_coverage":
      return fetchServerUpdateCoverage();
    case "component_compliance":
      return fetchComponentCompliance();
    case "esxi_upgrade_history":
      return fetchEsxiUpgradeHistory(dateRange);
    case "scp_backup_status":
      return fetchScpBackupStatus();
    case "backup_history":
      return fetchBackupHistory(dateRange);
    case "backup_coverage":
      return fetchBackupCoverage();
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
    ) || 0,
  };

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
    .select("hostname, model, bios_version, idrac_firmware, redfish_version, connection_status, last_seen")
    .order("hostname");

  if (error) throw error;

  const rows = servers || [];
  
  const withFirmwareData = rows.filter(s => 
    s.bios_version || s.idrac_firmware || s.redfish_version
  ).length;
  const missingFirmwareData = rows.length - withFirmwareData;

  const uniqueBiosVersions = new Set(
    rows.filter(s => s.bios_version).map(s => s.bios_version)
  ).size;
  const uniqueIdracVersions = new Set(
    rows.filter(s => s.idrac_firmware).map(s => s.idrac_firmware)
  ).size;

  const summary = {
    total: rows.length,
    withFirmware: withFirmwareData,
    missingFirmware: missingFirmwareData,
    uniqueBiosVersions,
    uniqueIdracVersions,
  };

  const chartData = [
    { name: "With Firmware Data", value: withFirmwareData },
    { name: "Missing Firmware Data", value: missingFirmwareData },
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

// ============= NEW UPDATE REPORTS =============

const UPDATE_JOB_TYPES = [
  // Firmware updates
  'firmware_update',
  'full_server_update',
  'firmware_inventory_scan',
  // BIOS configuration
  'bios_config_write',
  // Cluster-level updates
  'rolling_cluster_update',
  'prepare_host_for_update',
  'verify_host_after_update',
  // ESXi upgrades
  'esxi_upgrade',
  'esxi_then_firmware',
  'firmware_then_esxi',
] as const;

const JOB_TYPE_LABELS: Record<string, string> = {
  firmware_update: 'Firmware Update',
  full_server_update: 'Full Server Update',
  firmware_inventory_scan: 'Firmware Scan',
  bios_config_write: 'BIOS Configuration',
  rolling_cluster_update: 'Rolling Cluster Update',
  prepare_host_for_update: 'Host Preparation',
  verify_host_after_update: 'Host Verification',
  esxi_upgrade: 'ESXi Upgrade',
  esxi_then_firmware: 'ESXi + Firmware',
  firmware_then_esxi: 'Firmware + ESXi',
};

async function fetchUpdateHistory(dateRange: { start: Date; end: Date }): Promise<ReportData> {
  // Fetch jobs that are update-related - EXCLUDE pending for audit purposes
  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select(`
      id,
      job_type,
      status,
      created_at,
      started_at,
      completed_at,
      created_by,
      details,
      priority
    `)
    .in("job_type", UPDATE_JOB_TYPES)
    .in("status", ["completed", "failed"]) // Only completed/failed for audit
    .gte("created_at", dateRange.start.toISOString())
    .lte("created_at", dateRange.end.toISOString())
    .order("created_at", { ascending: false });

  if (jobsError) throw jobsError;

  const jobIds = (jobs || []).map(j => j.id);
  
  // Fetch workflow executions to get rich component update details
  let workflowExecutions: any[] = [];
  if (jobIds.length > 0) {
    const { data: wfData } = await supabase
      .from("workflow_executions")
      .select("job_id, server_id, cluster_id, step_name, step_details, step_status, step_started_at, step_completed_at")
      .in("job_id", jobIds);
    workflowExecutions = wfData || [];
  }

  // Fetch job tasks to get server-level details
  let tasks: any[] = [];
  if (jobIds.length > 0) {
    const { data: taskData } = await supabase
      .from("job_tasks")
      .select("id, job_id, server_id, status, started_at, completed_at, log")
      .in("job_id", jobIds);
    tasks = taskData || [];
  }

  // Fetch servers for hostname lookup
  const { data: servers } = await supabase
    .from("servers")
    .select("id, hostname, ip_address");

  const serverMap = (servers || []).reduce((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {} as Record<string, any>);

  // Fetch profiles for "initiated by" column
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email");

  const profileMap = (profiles || []).reduce((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {} as Record<string, any>);

  // Fetch clusters for cluster name lookup
  const { data: clusters } = await supabase
    .from("vcenter_clusters")
    .select("id, cluster_name");

  const clusterMap = (clusters || []).reduce((acc, c) => {
    acc[c.id] = c.cluster_name;
    return acc;
  }, {} as Record<string, string>);

  // Fetch vcenter hosts for host-to-cluster mapping
  const { data: vcenterHosts } = await supabase
    .from("vcenter_hosts")
    .select("id, server_id, cluster");

  const serverToClusterMap = (vcenterHosts || []).reduce((acc, h) => {
    if (h.server_id) {
      acc[h.server_id] = h.cluster || '';
    }
    return acc;
  }, {} as Record<string, string>);

  // Fetch SCP backups to check if server has backup
  const { data: scpBackups } = await supabase
    .from("scp_backups")
    .select("server_id, exported_at")
    .order("exported_at", { ascending: false });

  const serverBackupMap = (scpBackups || []).reduce((acc, b) => {
    if (!acc[b.server_id]) {
      acc[b.server_id] = b.exported_at;
    }
    return acc;
  }, {} as Record<string, string>);

  // Group workflow executions by job_id and server_id for component details
  const workflowByJobServer = workflowExecutions.reduce((acc, wf) => {
    const key = `${wf.job_id}-${wf.server_id || 'job'}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(wf);
    return acc;
  }, {} as Record<string, any[]>);

  // Helper to extract component update info from workflow steps
  const getComponentInfo = (workflows: any[]) => {
    // Look for "Check for updates" steps which contain the updates array
    const updateStep = workflows?.find(w => 
      w.step_name?.startsWith('Check for updates:') || 
      w.step_name?.startsWith('Apply firmware:')
    );
    
    const updates = updateStep?.step_details?.updates || updateStep?.step_details?.available_updates_list || [];
    
    if (Array.isArray(updates) && updates.length > 0) {
      // Build component summary: "BIOS 2.23→2.25, QLogic 16.25→17.05"
      const componentSummary = updates
        .slice(0, 3) // Show first 3
        .map((u: any) => {
          const shortName = u.name?.split(' ')[0] || u.component || 'Unknown';
          return `${shortName} ${u.current_version || '?'}→${u.available_version || u.target_version || '?'}`;
        })
        .join(", ");
      
      const suffix = updates.length > 3 ? ` +${updates.length - 3} more` : '';
      
      return {
        componentsUpdated: updates.length,
        componentSummary: componentSummary + suffix,
        highestCriticality: updates.some((u: any) => u.criticality === 'Critical') ? 'Critical' 
          : updates.some((u: any) => u.criticality === 'Recommended') ? 'Recommended' 
          : 'Optional',
        rebootRequired: updates.some((u: any) => u.reboot_required === 'HOST' || u.reboot_required === true),
      };
    }
    
    // Check for available_updates count (used in some workflow types)
    const availableCount = updateStep?.step_details?.available_updates;
    if (typeof availableCount === 'number' && availableCount > 0) {
      return {
        componentsUpdated: availableCount,
        componentSummary: `${availableCount} component(s)`,
        highestCriticality: 'Unknown',
        rebootRequired: true,
      };
    }
    
    return null;
  };

  // Helper to format duration
  const formatDuration = (ms: number | null): string => {
    if (!ms) return "-";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  // Build rows - one row per server updated
  const rows: any[] = [];
  const processedServers = new Set<string>(); // Track job-server combos to avoid duplicates

  for (const job of jobs || []) {
    const details = job.details as any || {};
    const profile = profileMap[job.created_by];
    const initiatedBy = profile?.full_name || profile?.email || 'System';
    
    // Get tasks for this job
    const jobTasks = tasks.filter(t => t.job_id === job.id);
    
    // Get workflows for this job
    const jobWorkflows = workflowExecutions.filter(w => w.job_id === job.id);
    
    // Get cluster from job details or workflow
    const jobClusterId = details.cluster_id || jobWorkflows.find(w => w.cluster_id)?.cluster_id;
    const jobClusterName = details.cluster_name || (jobClusterId ? clusterMap[jobClusterId] : null);
    
    // Duration
    const durationMs = job.completed_at && job.started_at 
      ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
      : null;

    if (jobTasks.length === 0 && jobWorkflows.length === 0) {
      // Job-level row (no server breakdown)
      rows.push({
        job_id: job.id,
        job_type: job.job_type,
        job_type_label: JOB_TYPE_LABELS[job.job_type] || job.job_type,
        status: job.status,
        server: details.server_hostname || details.cluster_name || '-',
        server_ip: details.server_ip || '-',
        cluster_name: jobClusterName || '-',
        components_updated: null,
        component_summary: details.component || JOB_TYPE_LABELS[job.job_type] || '-',
        highest_criticality: null,
        reboot_required: false,
        scp_backup: false,
        initiated_by: initiatedBy,
        started_at: job.started_at,
        completed_at: job.completed_at,
        duration_ms: durationMs,
        duration_formatted: formatDuration(durationMs),
      });
      continue;
    }

    // Get unique servers from tasks and workflows
    const serverIds = new Set<string>();
    jobTasks.forEach(t => t.server_id && serverIds.add(t.server_id));
    jobWorkflows.forEach(w => w.server_id && serverIds.add(w.server_id));

    if (serverIds.size === 0) {
      // Job/cluster level - use workflow data if available
      const componentInfo = getComponentInfo(jobWorkflows);
      rows.push({
        job_id: job.id,
        job_type: job.job_type,
        job_type_label: JOB_TYPE_LABELS[job.job_type] || job.job_type,
        status: job.status,
        server: details.cluster_name || '-',
        server_ip: '-',
        cluster_name: jobClusterName || '-',
        components_updated: componentInfo?.componentsUpdated || null,
        component_summary: componentInfo?.componentSummary || JOB_TYPE_LABELS[job.job_type] || '-',
        highest_criticality: componentInfo?.highestCriticality || null,
        reboot_required: componentInfo?.rebootRequired || false,
        scp_backup: false,
        initiated_by: initiatedBy,
        started_at: job.started_at,
        completed_at: job.completed_at,
        duration_ms: durationMs,
        duration_formatted: formatDuration(durationMs),
      });
      continue;
    }

    // Create a row per server
    for (const serverId of serverIds) {
      const key = `${job.id}-${serverId}`;
      if (processedServers.has(key)) continue;
      processedServers.add(key);

      const server = serverMap[serverId];
      const task = jobTasks.find(t => t.server_id === serverId);
      const serverWorkflows = workflowByJobServer[key] || [];
      
      // Get component info from workflows
      const componentInfo = getComponentInfo(serverWorkflows);
      
      // Get cluster name
      const clusterName = serverToClusterMap[serverId] || jobClusterName || '-';
      
      // Check for SCP backup (was there a backup before this job?)
      const hasScpBackup = !!serverBackupMap[serverId];

      // Determine effective status
      const effectiveStatus = task?.status === 'pending' && ['failed', 'cancelled', 'completed'].includes(job.status)
        ? (job.status === 'completed' ? 'skipped' : job.status)
        : (task?.status || job.status);

      // Calculate server-specific duration from task or workflow
      const serverDurationMs = task?.completed_at && task?.started_at
        ? new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()
        : durationMs;

      rows.push({
        job_id: job.id,
        job_type: job.job_type,
        job_type_label: JOB_TYPE_LABELS[job.job_type] || job.job_type,
        status: effectiveStatus,
        server: server?.hostname || '-',
        server_ip: server?.ip_address || '-',
        cluster_name: clusterName,
        components_updated: componentInfo?.componentsUpdated || null,
        component_summary: componentInfo?.componentSummary || JOB_TYPE_LABELS[job.job_type] || '-',
        highest_criticality: componentInfo?.highestCriticality || null,
        reboot_required: componentInfo?.rebootRequired || false,
        scp_backup: hasScpBackup,
        initiated_by: initiatedBy,
        started_at: task?.started_at || job.started_at,
        completed_at: task?.completed_at || job.completed_at,
        duration_ms: serverDurationMs,
        duration_formatted: formatDuration(serverDurationMs),
      });
    }
  }

  // Calculate summary stats
  const totalComponentsUpdated = rows.reduce((sum, r) => sum + (r.components_updated || 0), 0);
  const criticalUpdates = rows.filter(r => r.highest_criticality === 'Critical').length;
  const avgDuration = rows.length > 0 
    ? Math.round(rows.reduce((sum, r) => sum + (r.duration_ms || 0), 0) / rows.length)
    : 0;
  const scpBackupsCount = rows.filter(r => r.scp_backup).length;

  const summary = {
    serversUpdated: rows.length,
    totalComponents: totalComponentsUpdated,
    criticalUpdates,
    completed: rows.filter(r => r.status === "completed").length,
    failed: rows.filter(r => r.status === "failed").length,
    successRate: rows.length > 0 
      ? Math.round((rows.filter(r => r.status === "completed").length / rows.length) * 100) + "%"
      : "N/A",
    avgDuration: formatDuration(avgDuration),
    scpBackups: scpBackupsCount,
  };

  // Chart: updates per day
  const updatesByDay = rows.reduce((acc, r) => {
    const day = r.started_at ? format(new Date(r.started_at), "yyyy-MM-dd") : "unknown";
    if (!acc[day]) acc[day] = { completed: 0, failed: 0, total: 0, components: 0 };
    acc[day].total++;
    acc[day].components += r.components_updated || 0;
    if (r.status === "completed") acc[day].completed++;
    if (r.status === "failed") acc[day].failed++;
    return acc;
  }, {} as Record<string, any>);

  const chartData = Object.entries(updatesByDay)
    .filter(([date]) => date !== "unknown")
    .map(([date, stats]) => ({ date, ...(stats as object) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { rows, summary, chartData };
}

async function fetchUpdateFailures(dateRange: { start: Date; end: Date }): Promise<ReportData> {
  // Fetch failed update jobs
  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select(`
      id,
      job_type,
      status,
      created_at,
      started_at,
      completed_at,
      details
    `)
    .in("job_type", UPDATE_JOB_TYPES)
    .eq("status", "failed")
    .gte("created_at", dateRange.start.toISOString())
    .lte("created_at", dateRange.end.toISOString())
    .order("created_at", { ascending: false });

  if (jobsError) throw jobsError;

  // Fetch failed tasks for more detail
  const jobIds = (jobs || []).map(j => j.id);
  let tasks: any[] = [];
  
  if (jobIds.length > 0) {
    const { data: taskData } = await supabase
      .from("job_tasks")
      .select("id, job_id, server_id, status, log")
      .in("job_id", jobIds)
      .eq("status", "failed");
    
    tasks = taskData || [];
  }

  // Fetch servers
  const { data: servers } = await supabase
    .from("servers")
    .select("id, hostname, ip_address");

  const serverMap = (servers || []).reduce((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {} as Record<string, any>);

  const rows = (jobs || []).map(job => {
    const jobTasks = tasks.filter(t => t.job_id === job.id);
    const details = job.details as any;
    const errorMsg = details?.error || details?.message || jobTasks[0]?.log || "Unknown error";
    const server = jobTasks[0]?.server_id ? serverMap[jobTasks[0].server_id] : null;
    
    return {
      job_id: job.id,
      job_type: job.job_type,
      job_type_label: JOB_TYPE_LABELS[job.job_type] || job.job_type,
      server: server?.hostname || details?.server_hostname || details?.cluster_name || "-",
      server_ip: server?.ip_address || details?.server_ip || "-",
      error: errorMsg.substring(0, 200),
      attempted_at: job.started_at || job.created_at,
      duration_ms: job.completed_at && job.started_at 
        ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
        : null,
    };
  });

  // Group errors by type for chart
  const errorTypes = rows.reduce((acc, r) => {
    const errorType = r.error.includes("timeout") ? "Timeout" 
      : r.error.includes("credential") || r.error.includes("auth") ? "Authentication"
      : r.error.includes("connection") || r.error.includes("network") ? "Connection"
      : r.error.includes("not found") ? "Not Found"
      : "Other";
    acc[errorType] = (acc[errorType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const summary = {
    totalFailures: rows.length,
    topErrorType: Object.entries(errorTypes).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A",
    affectedServers: new Set(rows.map(r => r.server).filter(s => s !== "-")).size,
  };

  const chartData = Object.entries(errorTypes).map(([name, value]) => ({ name, value }));

  return { rows, summary, chartData };
}

async function fetchServerUpdateCoverage(): Promise<ReportData> {
  // Get all servers
  const { data: servers, error: serversError } = await supabase
    .from("servers")
    .select("id, hostname, ip_address, model, connection_status")
    .order("hostname");

  if (serversError) throw serversError;

  // Get last successful update job for each server via job_tasks
  const { data: completedTasks } = await supabase
    .from("job_tasks")
    .select(`
      server_id,
      completed_at,
      jobs!inner (
        job_type,
        status
      )
    `)
    .eq("status", "completed")
    .not("server_id", "is", null)
    .order("completed_at", { ascending: false });

  // Build map of server -> last update
  const lastUpdateMap: Record<string, Date> = {};
  (completedTasks || []).forEach(task => {
    const job = task.jobs as any;
    if (UPDATE_JOB_TYPES.includes(job?.job_type) && job?.status === "completed") {
      if (!lastUpdateMap[task.server_id] || new Date(task.completed_at!) > lastUpdateMap[task.server_id]) {
        lastUpdateMap[task.server_id] = new Date(task.completed_at!);
      }
    }
  });

  const now = new Date();
  const rows = (servers || []).map(server => {
    const lastUpdate = lastUpdateMap[server.id];
    const daysSinceUpdate = lastUpdate ? differenceInDays(now, lastUpdate) : null;
    
    let coverageStatus: string;
    if (!lastUpdate) {
      coverageStatus = "Never Updated";
    } else if (daysSinceUpdate! <= 30) {
      coverageStatus = "Current (<30d)";
    } else if (daysSinceUpdate! <= 90) {
      coverageStatus = "Stale (30-90d)";
    } else {
      coverageStatus = "Critical (>90d)";
    }

    return {
      server: server.hostname,
      ip_address: server.ip_address,
      model: server.model,
      connection_status: server.connection_status,
      last_update: lastUpdate?.toISOString() || null,
      days_since_update: daysSinceUpdate,
      coverage_status: coverageStatus,
    };
  });

  const statusCounts = rows.reduce((acc, r) => {
    acc[r.coverage_status] = (acc[r.coverage_status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const summary = {
    totalServers: rows.length,
    current: statusCounts["Current (<30d)"] || 0,
    stale: statusCounts["Stale (30-90d)"] || 0,
    critical: statusCounts["Critical (>90d)"] || 0,
    neverUpdated: statusCounts["Never Updated"] || 0,
  };

  const chartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  return { rows, summary, chartData };
}

async function fetchComponentCompliance(): Promise<ReportData> {
  // Get firmware inventory
  const { data: inventory, error: invError } = await supabase
    .from("server_firmware_inventory")
    .select(`
      id,
      server_id,
      component_name,
      component_type,
      version,
      collected_at
    `)
    .order("collected_at", { ascending: false });

  if (invError) throw invError;

  // Get baseline packages
  const { data: baselines } = await supabase
    .from("firmware_packages")
    .select("id, component_type, dell_version, component_name_pattern, is_baseline")
    .eq("is_baseline", true);

  // Get servers for lookup
  const { data: servers } = await supabase
    .from("servers")
    .select("id, hostname, ip_address, model");

  const serverMap = (servers || []).reduce((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {} as Record<string, any>);

  // Get latest inventory per server/component
  const latestInventory: Record<string, any> = {};
  (inventory || []).forEach(item => {
    const key = `${item.server_id}-${item.component_name}`;
    if (!latestInventory[key] || new Date(item.collected_at) > new Date(latestInventory[key].collected_at)) {
      latestInventory[key] = item;
    }
  });

  const baselineMap = (baselines || []).reduce((acc, b) => {
    acc[b.component_type] = b;
    return acc;
  }, {} as Record<string, any>);

  const rows = Object.values(latestInventory).map(item => {
    const server = serverMap[item.server_id];
    const baseline = baselineMap[item.component_type];
    const compliant = baseline ? item.version === baseline.dell_version : null;

    return {
      server: server?.hostname || "-",
      server_ip: server?.ip_address || "-",
      component: item.component_name,
      component_type: item.component_type,
      current_version: item.version,
      baseline_version: baseline?.dell_version || "No baseline",
      compliant: baseline ? (compliant ? "Compliant" : "Non-compliant") : "No baseline",
      collected_at: item.collected_at,
    };
  });

  const complianceCounts = rows.reduce((acc, r) => {
    acc[r.compliant] = (acc[r.compliant] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const summary = {
    totalComponents: rows.length,
    compliant: complianceCounts["Compliant"] || 0,
    nonCompliant: complianceCounts["Non-compliant"] || 0,
    noBaseline: complianceCounts["No baseline"] || 0,
    complianceRate: rows.filter(r => r.compliant === "Compliant" || r.compliant === "No baseline").length > 0
      ? Math.round((complianceCounts["Compliant"] || 0) / rows.filter(r => r.compliant !== "No baseline").length * 100) + "%"
      : "N/A",
  };

  // Chart by component type
  const byType = rows.reduce((acc, r) => {
    if (!acc[r.component_type]) acc[r.component_type] = { compliant: 0, nonCompliant: 0 };
    if (r.compliant === "Compliant") acc[r.component_type].compliant++;
    else if (r.compliant === "Non-compliant") acc[r.component_type].nonCompliant++;
    return acc;
  }, {} as Record<string, any>);

  const chartData = Object.entries(byType).map(([name, counts]) => ({
    name,
    compliant: counts.compliant,
    nonCompliant: counts.nonCompliant,
  }));

  return { rows, summary, chartData };
}

async function fetchEsxiUpgradeHistory(dateRange: { start: Date; end: Date }): Promise<ReportData> {
  const { data: upgrades, error } = await supabase
    .from("esxi_upgrade_history")
    .select(`
      id,
      vcenter_host_id,
      server_id,
      status,
      version_before,
      version_after,
      started_at,
      completed_at,
      error_message
    `)
    .gte("created_at", dateRange.start.toISOString())
    .lte("created_at", dateRange.end.toISOString())
    .order("started_at", { ascending: false });

  if (error) throw error;

  // Get vcenter hosts for names
  const { data: hosts } = await supabase
    .from("vcenter_hosts")
    .select("id, name, cluster");

  const hostMap = (hosts || []).reduce((acc, h) => {
    acc[h.id] = h;
    return acc;
  }, {} as Record<string, any>);

  const rows = (upgrades || []).map(u => {
    const host = u.vcenter_host_id ? hostMap[u.vcenter_host_id] : null;
    return {
      host: host?.name || "-",
      cluster: host?.cluster || "-",
      version_before: u.version_before,
      version_after: u.version_after || "-",
      status: u.status,
      started_at: u.started_at,
      completed_at: u.completed_at,
      duration_ms: u.completed_at && u.started_at 
        ? new Date(u.completed_at).getTime() - new Date(u.started_at).getTime()
        : null,
      error: u.error_message,
    };
  });

  const summary = {
    totalUpgrades: rows.length,
    completed: rows.filter(r => r.status === "completed").length,
    failed: rows.filter(r => r.status === "failed").length,
    pending: rows.filter(r => r.status === "pending" || r.status === "running").length,
  };

  // Chart: upgrades per day
  const upgradesByDay = rows.reduce((acc, r) => {
    const day = r.started_at ? format(new Date(r.started_at), "yyyy-MM-dd") : "unknown";
    if (!acc[day]) acc[day] = { completed: 0, failed: 0, total: 0 };
    acc[day].total++;
    if (r.status === "completed") acc[day].completed++;
    if (r.status === "failed") acc[day].failed++;
    return acc;
  }, {} as Record<string, any>);

  const chartData = Object.entries(upgradesByDay)
    .filter(([date]) => date !== "unknown")
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { rows, summary, chartData };
}

async function fetchScpBackupStatus(): Promise<ReportData> {
  // Get all servers
  const { data: servers, error: serversError } = await supabase
    .from("servers")
    .select("id, hostname, ip_address, model")
    .order("hostname");

  if (serversError) throw serversError;

  // Get SCP backups
  const { data: backups } = await supabase
    .from("scp_backups")
    .select("id, server_id, backup_name, exported_at, scp_file_size_bytes, is_valid")
    .order("exported_at", { ascending: false });

  // Build map of server -> latest backup
  const latestBackupMap: Record<string, any> = {};
  (backups || []).forEach(b => {
    if (!latestBackupMap[b.server_id] || new Date(b.exported_at) > new Date(latestBackupMap[b.server_id].exported_at)) {
      latestBackupMap[b.server_id] = b;
    }
  });

  const now = new Date();
  const rows = (servers || []).map(server => {
    const backup = latestBackupMap[server.id];
    const daysSinceBackup = backup ? differenceInDays(now, new Date(backup.exported_at)) : null;
    
    let backupStatus: string;
    if (!backup) {
      backupStatus = "No Backup";
    } else if (daysSinceBackup! <= 30) {
      backupStatus = "Recent (<30d)";
    } else if (daysSinceBackup! <= 90) {
      backupStatus = "Stale (30-90d)";
    } else {
      backupStatus = "Very Old (>90d)";
    }

    return {
      server: server.hostname,
      ip_address: server.ip_address,
      model: server.model,
      last_backup: backup?.exported_at || null,
      backup_name: backup?.backup_name || "-",
      days_since_backup: daysSinceBackup,
      backup_status: backupStatus,
      is_valid: backup?.is_valid ?? null,
    };
  });

  const statusCounts = rows.reduce((acc, r) => {
    acc[r.backup_status] = (acc[r.backup_status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const summary = {
    totalServers: rows.length,
    recent: statusCounts["Recent (<30d)"] || 0,
    stale: statusCounts["Stale (30-90d)"] || 0,
    veryOld: statusCounts["Very Old (>90d)"] || 0,
    noBackup: statusCounts["No Backup"] || 0,
  };

  const chartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  return { rows, summary, chartData };
}

async function fetchBackupHistory(dateRange: { start: Date; end: Date }): Promise<ReportData> {
  // Get SCP backups within date range
  const { data: backups, error: backupsError } = await supabase
    .from("scp_backups")
    .select("*")
    .gte("exported_at", dateRange.start.toISOString())
    .lte("exported_at", dateRange.end.toISOString())
    .order("exported_at", { ascending: false });

  if (backupsError) throw backupsError;

  // Get servers for hostname lookup
  const { data: servers } = await supabase
    .from("servers")
    .select("id, hostname, ip_address, model");

  const serverMap = (servers || []).reduce((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {} as Record<string, any>);

  const rows = (backups || []).map(b => {
    const server = serverMap[b.server_id];
    return {
      server: server?.hostname || "-",
      ip_address: server?.ip_address || "-",
      model: server?.model || "-",
      backup_name: b.backup_name,
      components: b.components || "-",
      file_size: b.scp_file_size_bytes,
      is_valid: b.is_valid,
      exported_at: b.exported_at,
      export_job_id: b.export_job_id,
    };
  });

  // Calculate total size
  const totalSize = rows.reduce((sum, r) => sum + (r.file_size || 0), 0);
  const validCount = rows.filter(r => r.is_valid).length;

  const summary = {
    totalBackups: rows.length,
    validBackups: validCount,
    invalidBackups: rows.length - validCount,
    totalSize: formatBytes(totalSize),
  };

  // Chart: backups per day
  const backupsByDay = rows.reduce((acc, r) => {
    if (!r.exported_at) return acc;
    const day = format(new Date(r.exported_at), "yyyy-MM-dd");
    if (!acc[day]) acc[day] = { count: 0, size: 0 };
    acc[day].count++;
    acc[day].size += r.file_size || 0;
    return acc;
  }, {} as Record<string, any>);

  const chartData = Object.entries(backupsByDay)
    .map(([date, stats]) => ({ date, count: stats.count, size: stats.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { rows, summary, chartData };
}

async function fetchBackupCoverage(): Promise<ReportData> {
  // Get all servers
  const { data: servers, error: serversError } = await supabase
    .from("servers")
    .select("id, hostname, ip_address, model")
    .order("hostname");

  if (serversError) throw serversError;

  // Get SCP backups
  const { data: backups } = await supabase
    .from("scp_backups")
    .select("id, server_id, backup_name, exported_at, is_valid")
    .order("exported_at", { ascending: false });

  // Build map of server -> latest backup
  const latestBackupMap: Record<string, any> = {};
  (backups || []).forEach(b => {
    if (!latestBackupMap[b.server_id] || new Date(b.exported_at) > new Date(latestBackupMap[b.server_id].exported_at)) {
      latestBackupMap[b.server_id] = b;
    }
  });

  const now = new Date();
  const rows = (servers || [])
    .map(server => {
      const backup = latestBackupMap[server.id];
      const daysSinceBackup = backup ? differenceInDays(now, new Date(backup.exported_at)) : null;
      
      let coverageStatus: string;
      let actionNeeded: string;
      
      if (!backup) {
        coverageStatus = "Critical";
        actionNeeded = "Create initial backup";
      } else if (!backup.is_valid) {
        coverageStatus = "Warning";
        actionNeeded = "Invalid backup - re-export";
      } else if (daysSinceBackup! > 90) {
        coverageStatus = "Critical";
        actionNeeded = "Backup very stale (>90d)";
      } else if (daysSinceBackup! > 30) {
        coverageStatus = "Warning";
        actionNeeded = "Backup stale (>30d)";
      } else {
        coverageStatus = "OK";
        actionNeeded = "None";
      }

      return {
        server: server.hostname,
        ip_address: server.ip_address,
        model: server.model,
        coverage_status: coverageStatus,
        days_since_backup: daysSinceBackup,
        last_backup: backup?.exported_at || null,
        is_valid: backup?.is_valid ?? null,
        action_needed: actionNeeded,
      };
    })
    // Filter to only show servers needing attention (Critical or Warning)
    .filter(r => r.coverage_status !== "OK");

  const statusCounts = {
    critical: rows.filter(r => r.coverage_status === "Critical").length,
    warning: rows.filter(r => r.coverage_status === "Warning").length,
  };

  // Also count total servers for context
  const totalServers = servers?.length || 0;
  const compliant = totalServers - statusCounts.critical - statusCounts.warning;

  const summary = {
    needsAttention: rows.length,
    critical: statusCounts.critical,
    warning: statusCounts.warning,
    compliant,
    totalServers,
  };

  const chartData = [
    { name: "Critical", value: statusCounts.critical },
    { name: "Warning", value: statusCounts.warning },
    { name: "Compliant", value: compliant },
  ];

  return { rows, summary, chartData };
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
