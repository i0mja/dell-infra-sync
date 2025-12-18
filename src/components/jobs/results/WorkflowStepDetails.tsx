import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle, 
  Server, 
  Package, 
  Crown, 
  Target, 
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  RotateCcw
} from "lucide-react";

interface WorkflowStepDetailsProps {
  stepName: string;
  stepNumber: number;
  details: any;
}

export const WorkflowStepDetails = ({ stepName, stepNumber, details }: WorkflowStepDetailsProps) => {
  if (!details) return null;

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
  if (details.vcsa_detected !== undefined || details.total_hosts !== undefined || 
      details.hosts_needing_updates !== undefined || details.host_update_status !== undefined) {
    return <PreFlightResultsView details={details} />;
  }

  // 4. SCP backup progress/completion
  if (details.scp_progress !== undefined || details.backup_id !== undefined) {
    return <ScpBackupView details={details} />;
  }

  // 5. Fallback - render formatted details as key-value pairs
  return <FormattedDetailsView details={details} />;
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
            {details.host_order_adjusted && (
              <Badge variant="outline" className="text-xs">Reordered to last</Badge>
            )}
          </div>
        )}
        {details.update_scope && (
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Scope:</span>
            <span className="font-medium capitalize">{details.update_scope.replace(/_/g, ' ')}</span>
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
                <span className="text-green-700 dark:text-green-400 font-medium">
                  All hosts are up to date
                </span>
              </div>
            )}
            {hostsUpToDate > 0 && hostsNeedingUpdates > 0 && (
              <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded border border-green-500/20">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-green-700 dark:text-green-400 font-medium">
                  {hostsUpToDate} already current
                </span>
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
                      {host.update_count} update{host.update_count !== 1 ? 's' : ''}
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
    const critLower = (criticality || '').toLowerCase();
    if (critLower === 'critical' || critLower === '1') {
      return <Badge variant="destructive" className="text-xs">Critical</Badge>;
    }
    if (critLower === 'recommended' || critLower === '2') {
      return <Badge className="text-xs bg-amber-500 hover:bg-amber-600">Recommended</Badge>;
    }
    return <Badge variant="secondary" className="text-xs">Optional</Badge>;
  };

  const getRebootBadge = (rebootType: string) => {
    const reboot = (rebootType || '').toUpperCase();
    if (reboot === 'HOST' || reboot === 'SERVER' || reboot === 'REQUIRED') {
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
  const critical = updates.filter(u => (u.criticality || '').toLowerCase() === 'critical' || u.criticality === '1');
  const recommended = updates.filter(u => (u.criticality || '').toLowerCase() === 'recommended' || u.criticality === '2');
  const optional = updates.filter(u => !['critical', 'recommended', '1', '2'].includes((u.criticality || '').toLowerCase()));

  const renderUpdateItem = (update: any, index: number) => (
    <div key={index} className="flex items-start justify-between gap-4 py-2 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{update.name}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <span className="font-mono">{update.current_version || 'Unknown'}</span>
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
          {totalCount || updates.length} firmware update{(totalCount || updates.length) !== 1 ? 's' : ''} available
        </span>
      </div>

      {/* Critical Updates */}
      {critical.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-destructive">
            <AlertTriangle className="h-3 w-3" />
            Critical ({critical.length})
          </div>
          <div className="bg-destructive/5 rounded-md p-2 border border-destructive/20">
            {critical.map(renderUpdateItem)}
          </div>
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
          <div className="bg-muted/50 rounded-md p-2 border border-border/50">
            {optional.map(renderUpdateItem)}
          </div>
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
        <div className="text-sm text-muted-foreground">
          Export progress: {details.scp_progress}%
        </div>
      )}
    </div>
  );
};

// Formatted key-value view for unknown details
const FormattedDetailsView = ({ details }: { details: any }) => {
  // Filter out internal/technical fields
  const excludeKeys = ['_internal', 'raw_response', 'debug'];
  
  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  const formatKey = (key: string): string => {
    return key
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  };

  const entries = Object.entries(details)
    .filter(([key]) => !excludeKeys.includes(key))
    .filter(([, value]) => value !== null && value !== undefined);

  if (entries.length === 0) return null;

  // Check if any value is complex (object/array)
  const hasComplexValues = entries.some(([, value]) => typeof value === 'object');

  if (hasComplexValues) {
    // Fall back to formatted JSON for complex structures
    return (
      <div className="bg-muted/50 rounded p-3 text-xs font-mono overflow-x-auto">
        <pre className="whitespace-pre-wrap">{JSON.stringify(details, null, 2)}</pre>
      </div>
    );
  }

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
