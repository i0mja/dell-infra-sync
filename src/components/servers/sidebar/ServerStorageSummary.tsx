import { HardDrive, CheckCircle2, AlertTriangle, ExternalLink, XCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ServerDrive } from "@/hooks/useServerDrives";
import { CollapsibleSection } from "./CollapsibleSection";
import { isDriveCritical, getDriveFailureMessage } from "@/lib/driveHealth";
import { formatDistanceToNow } from "date-fns";

interface ServerStorageSummaryProps {
  drives: ServerDrive[];
  isLoading?: boolean;
  totalStorageTB?: number | null;
  onViewAll?: () => void;
}

function formatCapacity(gb: number | null): string {
  if (!gb) return "—";
  if (gb >= 1000) {
    return `${(gb / 1000).toFixed(1)} TB`;
  }
  return `${Math.round(gb)} GB`;
}

function DriveHealthIcon({ drive }: { drive: ServerDrive }) {
  // Critical, Disabled, or UnavailableOffline drives - show red X
  if (isDriveCritical(drive)) {
    return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  }
  if (drive.predicted_failure) {
    return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  }
  if (drive.health === "OK") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  }
  if (drive.health === "Warning" || (drive.life_remaining_percent && drive.life_remaining_percent < 20)) {
    return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
  }
  return <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function ServerStorageSummary({ 
  drives, 
  isLoading, 
  totalStorageTB,
  onViewAll 
}: ServerStorageSummaryProps) {
  if (isLoading) {
    return (
      <CollapsibleSection icon={HardDrive} title="Storage" count="...">
        <div className="text-xs text-muted-foreground animate-pulse">Loading drives...</div>
      </CollapsibleSection>
    );
  }

  if (!drives || drives.length === 0) {
    return (
      <CollapsibleSection icon={HardDrive} title="Storage" count="0">
        <div className="text-xs text-muted-foreground">
          No drive data available. Run a server refresh to collect storage information.
        </div>
      </CollapsibleSection>
    );
  }

  // Calculate health summary
  const criticalCount = drives.filter(d => isDriveCritical(d)).length;
  const healthyCount = drives.filter(d => 
    d.health === "OK" && 
    !d.predicted_failure && 
    !isDriveCritical(d)
  ).length;
  const warningCount = drives.filter(d => 
    (d.health === "Warning" || 
     d.predicted_failure || 
     (d.life_remaining_percent && d.life_remaining_percent < 20)) &&
    !isDriveCritical(d)
  ).length;

  // Calculate total capacity
  const totalCapacityGB = drives.reduce((sum, d) => sum + (d.capacity_gb || 0), 0);
  const capacityDisplay = totalStorageTB 
    ? `${totalStorageTB} TB` 
    : formatCapacity(totalCapacityGB);

  const countDisplay = `${drives.length} • ${capacityDisplay}`;

  return (
    <CollapsibleSection 
      icon={HardDrive} 
      title="Storage" 
      count={countDisplay}
      defaultOpen={false}
    >
      {/* Health Summary */}
      <div className="flex items-center gap-3 mb-2 text-xs">
        <span className="text-success flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {healthyCount} healthy
        </span>
        {criticalCount > 0 && (
          <span className="text-destructive flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            {criticalCount} critical
          </span>
        )}
        {warningCount > 0 && (
          <span className="text-warning flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {warningCount} warning
          </span>
        )}
      </div>

      {/* Drive List */}
      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
        {drives.map((drive) => (
          <div
            key={drive.id}
            className="flex items-start gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-xs"
          >
            <div className="flex-shrink-0 mt-0.5">
              <DriveHealthIcon drive={drive} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">
                  {drive.model || drive.name || "Unknown Drive"}
                </span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 flex-shrink-0">
                  {drive.media_type || drive.protocol || "—"}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground mt-0.5 flex-wrap">
                {drive.serial_number && (
                  <span className="font-mono text-[10px]">SN: {drive.serial_number}</span>
                )}
                {drive.slot != null && <span>{drive.serial_number ? '•' : ''} Bay {drive.slot}</span>}
                {drive.capacity_gb && <span>• {formatCapacity(drive.capacity_gb)}</span>}
                {drive.manufacturer && <span className="truncate">• {drive.manufacturer}</span>}
              </div>
              {/* Critical/Disabled/UnavailableOffline status */}
              {isDriveCritical(drive) && (
                <div className="flex items-center gap-1 mt-1 text-destructive">
                  <XCircle className="h-3 w-3" />
                  <span className="text-[10px] font-medium">
                    {getDriveFailureMessage(drive)}
                  </span>
                </div>
              )}
              {/* Missing serial number warning for failed drives - show last known if available */}
              {!drive.serial_number && isDriveCritical(drive) && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {drive.last_known_serial_number ? (
                    <span>Last known S/N: <span className="font-mono">{drive.last_known_serial_number}</span></span>
                  ) : (
                    <span>Serial number unavailable (drive may need replacement)</span>
                  )}
                </div>
              )}
              {/* Show when the drive failed */}
              {drive.failed_at && isDriveCritical(drive) && (
                <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  Failed {formatDistanceToNow(new Date(drive.failed_at))} ago
                </div>
              )}
              {drive.predicted_failure && !isDriveCritical(drive) && (
                <div className="flex items-center gap-1 mt-1 text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  <span className="text-[10px] font-medium">Predicted failure</span>
                </div>
              )}
              {drive.life_remaining_percent !== null && drive.life_remaining_percent < 20 && !drive.predicted_failure && !isDriveCritical(drive) && (
                <div className="text-warning text-[10px] mt-1">
                  {drive.life_remaining_percent}% life remaining
                </div>
              )}
            </div>
          </div>
        ))}

        {onViewAll && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-7 mt-1"
            onClick={onViewAll}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View Drive Details
          </Button>
        )}
      </div>
    </CollapsibleSection>
  );
}
