import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Server,
  Package,
  Crown,
  Target,
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
  ShieldCheck,
  Wrench,
} from "lucide-react";

interface WorkflowStepDetailsProps {
  stepName: string;
  stepNumber: number;
  details: any;
}

export const WorkflowStepDetails = ({ stepName, stepNumber, details }: WorkflowStepDetailsProps) => {
  if (!details) return null;

  const [showRawJson, setShowRawJson] = useState(false);

  const vmwareHighlights = useMemo(() => buildVmwareHighlights(details), [details]);
  const redfishSummaries = useMemo(() => buildRedfishSummaries(details), [details]);
  const genericPairs = useMemo(() => buildGenericPairs(details), [details]);

  // Detect step type based on content and render appropriately

  // 1. "No updates needed" - simple success message
  if (details.no_updates_needed) {
    return (
      <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-md border border-green-500/20">
        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
        <span className="text-sm text-green-700 dark:text-green-400">
          {details.message || "Server is already up to date"}
        </span>
      </div>
    );
  }

  // 2. Updates available - render as a clean table
  if (details.updates && Array.isArray(details.updates) && details.updates.length > 0) {
    return <UpdatesAvailableView updates={details.updates} totalCount={details.available_updates} />;
  }

  // 3. Pre-flight check results (including update check summary)
  if (
    details.vcsa_detected !== undefined ||
    details.total_hosts !== undefined ||
    details.hosts_needing_updates !== undefined ||
    details.host_update_status !== undefined
  ) {
    return <PreFlightResultsView details={details} />;
  }

  // 4. SCP backup progress/completion
  if (details.scp_progress !== undefined || details.backup_id !== undefined) {
    return <ScpBackupView details={details} />;
  }

  // 5. Fallback - render formatted details as key-value pairs and summaries
  return (
    <div className="space-y-3">
      {vmwareHighlights.length > 0 && (
        <SummaryList title="VMware context" icon={<ShieldCheck className="h-4 w-4" />} items={vmwareHighlights} />
      )}

      {redfishSummaries.length > 0 && (
        <SummaryList
          title="Redfish hardware jobs"
          icon={<Wrench className="h-4 w-4" />}
          items={redfishSummaries}
        />
      )}

      {genericPairs && Object.keys(genericPairs).length > 0 && <FormattedDetailsView details={genericPairs} />}

      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowRawJson((prev) => !prev)}
        aria-label={showRawJson ? "Hide raw JSON" : "View raw JSON"}
      >
        {showRawJson ? "Hide raw JSON" : "View raw JSON"}
      </Button>

      {showRawJson && (
        <div className="bg-muted/50 rounded p-3 text-xs font-mono overflow-x-auto" data-testid="raw-json-block">
          <pre className="whitespace-pre-wrap">{JSON.stringify(details, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

// Pre-flight check results component (including update availability summary)
const PreFlightResultsView = ({ details }: { details: any }) => {
  const hostsNeedingUpdates = details.hosts_needing_updates;
  const hostsUpToDate = details.hosts_up_to_date;
  const totalHosts = details.total_hosts;
  const hostUpdateStatus = details.host_update_status;

  return (
    <div className="space-y-3 p-3 bg-muted/50 rounded-md">
      {/* Basic info grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        {details.target_type && (
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Target:</span>
            <span className="font-medium capitalize">{details.target_type}</span>
          </div>
        )}
        {totalHosts !== undefined && (
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Hosts:</span>
            <span className="font-medium">{totalHosts} detected</span>
          </div>
        )}
        {details.vcsa_host && (
          <div className="flex items-center gap-2 col-span-2">
            <Crown className="h-4 w-4 text-amber-500" />
            <span className="text-muted-foreground">VCSA Host:</span>
            <span className="font-medium">{details.vcsa_host}</span>
            {details.host_order_adjusted && <Badge variant="outline">Reordered to last</Badge>}
          </div>
        )}
        {details.update_scope && (
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Scope:</span>
            <span className="font-medium capitalize">{details.update_scope.replace(/_/g, " ")}</span>
          </div>
        )}
      </div>

      {/* Update availability summary (when pre-flight includes update check) */}
      {hostsNeedingUpdates !== undefined && (
        <div className="border-t border-border/50 pt-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <RefreshCw className="h-4 w-4 text-blue-500" />
            Update Availability Check
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {hostsNeedingUpdates > 0 ? (
              <div className="flex items-center gap-2 p-2 bg-blue-500/10 rounded border border-blue-500/20">
                <Package className="h-4 w-4 text-blue-500" />
                <span className="text-blue-700 dark:text-blue-400 font-medium">
                  {hostsNeedingUpdates} need updates
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded border border-green-500/20 col-span-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-green-700 dark:text-green-400 font-medium">All hosts are up to date</span>
              </div>
            )}
            {hostsUpToDate > 0 && hostsNeedingUpdates > 0 && (
              <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded border border-green-500/20">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-green-700 dark:text-green-400 font-medium">{hostsUpToDate} already current</span>
              </div>
            )}
          </div>

          {/* Per-host update status */}
          {hostUpdateStatus && Array.isArray(hostUpdateStatus) && hostUpdateStatus.length > 0 && (
            <div className="space-y-1 text-xs">
              {hostUpdateStatus.map((host: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
                  <span className="font-medium truncate">{host.name}</span>
                  {host.needs_update ? (
                    <Badge variant="outline" className="text-xs bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400">
                      {host.update_count} update{host.update_count !== 1 ? "s" : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Current
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {details.vcsa_detected && (
        <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 mt-2">
          <CheckCircle className="h-3 w-3" />
          VCSA detected - will be updated last to maintain management access
        </div>
      )}
    </div>
  );
};

// Updates available table component
const UpdatesAvailableView = ({ updates, totalCount }: { updates: any[]; totalCount?: number }) => {
  const getCriticalityBadge = (criticality: string) => {
    const critLower = (criticality || "").toLowerCase();
    if (critLower === "critical" || critLower === "1") {
      return <Badge variant="destructive" className="text-xs">Critical</Badge>;
    }
    if (critLower === "recommended" || critLower === "2") {
      return <Badge className="text-xs bg-amber-500 hover:bg-amber-600">Recommended</Badge>;
    }
    return <Badge variant="secondary" className="text-xs">Optional</Badge>;
  };

  const getRebootBadge = (rebootType: string) => {
    const reboot = (rebootType || "").toUpperCase();
    if (reboot === "HOST" || reboot === "SERVER" || reboot === "REQUIRED") {
      return (
        <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          <RotateCcw className="h-3 w-3" />
          Host reboot
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle className="h-3 w-3" />
        No reboot
      </span>
    );
  };

  // Group updates by criticality
  const critical = updates.filter((u) => (u.criticality || "").toLowerCase() === "critical" || u.criticality === "1");
  const recommended = updates.filter(
    (u) => (u.criticality || "").toLowerCase() === "recommended" || u.criticality === "2",
  );
  const optional = updates.filter((u) => !["critical", "recommended", "1", "2"].includes((u.criticality || "").toLowerCase()));

  const renderUpdateItem = (update: any, index: number) => (
    <div key={index} className="flex items-start justify-between gap-4 py-2 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{update.name}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <span className="font-mono">{update.current_version || "Unknown"}</span>
          <ArrowRight className="h-3 w-3" />
          <span className="font-mono text-foreground">{update.available_version}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {getCriticalityBadge(update.criticality)}
        {getRebootBadge(update.reboot_required)}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Summary Banner */}
      <div className="flex items-center gap-2 p-2 bg-blue-500/10 rounded-md border border-blue-500/20">
        <RefreshCw className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
          {totalCount || updates.length} firmware update{(totalCount || updates.length) !== 1 ? "s" : ""} available
        </span>
      </div>

      {/* Critical Updates */}
      {critical.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-destructive">
            <AlertTriangle className="h-3 w-3" />
            Critical ({critical.length})
          </div>
          <div className="bg-destructive/5 rounded-md p-2 border border-destructive/20">{critical.map(renderUpdateItem)}</div>
        </div>
      )}

      {/* Recommended Updates */}
      {recommended.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Package className="h-3 w-3" />
            Recommended ({recommended.length})
          </div>
          <div className="bg-amber-500/5 rounded-md p-2 border border-amber-500/20">
            {recommended.map(renderUpdateItem)}
          </div>
        </div>
      )}

      {/* Optional Updates */}
      {optional.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Package className="h-3 w-3" />
            Optional ({optional.length})
          </div>
          <div className="bg-muted/50 rounded-md p-2 border border-border/50">{optional.map(renderUpdateItem)}</div>
        </div>
      )}
    </div>
  );
};

// SCP backup view component
const ScpBackupView = ({ details }: { details: any }) => {
  return (
    <div className="p-3 bg-muted/50 rounded-md space-y-2">
      {details.backup_id && (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span>Backup completed</span>
          <span className="text-muted-foreground font-mono text-xs">ID: {details.backup_id.slice(0, 8)}</span>
        </div>
      )}
      {details.backup_name && (
        <div className="text-sm text-muted-foreground">
          Name: <span className="font-medium text-foreground">{details.backup_name}</span>
        </div>
      )}
      {details.scp_progress !== undefined && details.scp_progress < 100 && (
        <div className="text-sm text-muted-foreground">Export progress: {details.scp_progress}%</div>
      )}
    </div>
  );
};

// Formatted key-value view for unknown details
const FormattedDetailsView = ({ details }: { details: Record<string, any> }) => {
  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  };

  const formatKey = (key: string): string => {
    return key
      .replace(/_/g, " ")
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  };

  const entries = Object.entries(details).filter(([, value]) => value !== null && value !== undefined);

  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 p-3 bg-muted/50 rounded-md text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col">
          <span className="text-muted-foreground text-xs">{formatKey(key)}</span>
          <span className="font-medium">{formatValue(value)}</span>
        </div>
      ))}
    </div>
  );
};

const SummaryList = ({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) => {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border border-border/50 bg-muted/50 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        <span>{title}</span>
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const buildVmwareHighlights = (details: any): string[] => {
  const highlights: string[] = [];

  if (details.maintenance_mode !== undefined) {
    highlights.push(`Maintenance mode ${details.maintenance_mode ? "enabled" : "disabled"}`);
  }

  if (details.vms_evacuated !== undefined) {
    highlights.push(`${details.vms_evacuated} VMs evacuated`);
  }

  if (Array.isArray(details.evacuated_vms)) {
    highlights.push(`${details.evacuated_vms.length} VMs evacuated: ${details.evacuated_vms.join(", ")}`);
  }

  if (details.vms_remaining?.length) {
    highlights.push(`${details.vms_remaining.length} VMs waiting for evacuation`);
  }

  if (details.ha_disabled || details.disable_ha) {
    highlights.push("vSphere HA disabled for maintenance");
  }

  if (details.drs_disabled || details.drs_mode === "manual") {
    highlights.push("DRS set to manual during evacuation");
  }

  if (details.ha_enabled) {
    highlights.push("HA re-enabled after host updates");
  }

  if (details.drs_enabled || details.drs_mode === "fully_automated") {
    highlights.push("DRS restored to fully automated");
  }

  if (details.current_host) {
    highlights.push(`Host: ${details.current_host}`);
  }

  return Array.from(new Set(highlights));
};

const buildRedfishSummaries = (details: any): string[] => {
  const summaries: string[] = [];
  const jobs = details.firmware_jobs || details.jobs || details.redfish_jobs;

  if (Array.isArray(jobs)) {
    jobs.forEach((job: any) => {
      const name = job.name || job.job_name || "Firmware job";
      const component = job.component || job.target || job.device || job.firmware_type;
      const percent = job.percent_complete ?? job.progress;
      const status = job.status || job.job_status || job.state;

      const parts = [name];
      if (component) parts.push(component);
      if (percent !== undefined) parts.push(`${percent}%`);
      if (status) parts.push(status);
      summaries.push(parts.join(" · "));
    });
  }

  if (details.reboot_required) {
    summaries.push("Host reboot required to apply firmware");
  }

  if (details.update_payload) {
    const payload = details.update_payload;
    if (payload.component && payload.target_version) {
      summaries.push(`Updating ${payload.component} to ${payload.target_version}`);
    }
  }

  return Array.from(new Set(summaries));
};

const buildGenericPairs = (details: any): Record<string, any> => {
  const excludeKeys = ["_internal", "raw_response", "debug", "payload", "evacuated_vms", "vms_remaining", "jobs", "firmware_jobs", "redfish_jobs", "update_payload"];
  const pairs: Record<string, any> = {};

  Object.entries(details || {}).forEach(([key, value]) => {
    if (excludeKeys.includes(key)) return;
    if (typeof value === "object" && !Array.isArray(value)) return;
    pairs[key] = value;
  });

  return pairs;
};
