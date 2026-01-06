import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ServerMemory } from "@/hooks/useServerMemory";
import type { ServerDrive } from "@/hooks/useServerDrives";

interface MemoryIssueProps {
  memory: ServerMemory;
}

export function MemoryIssueDetail({ memory }: MemoryIssueProps) {
  const isCritical = memory.health === "Critical" || memory.status === "Disabled";
  const slotName = memory.slot_name || memory.dimm_identifier || "Unknown Slot";
  
  // Format capacity
  const capacityGB = memory.capacity_mb 
    ? `${(memory.capacity_mb / 1024).toFixed(0)} GB` 
    : null;
  
  // Build detail line
  const details = [capacityGB, memory.manufacturer].filter(Boolean).join(" • ");
  
  // Serial number status
  const hasSerial = memory.serial_number && memory.serial_number !== "Unknown";

  return (
    <div className={cn(
      "rounded-md p-2.5 text-sm border",
      isCritical 
        ? "bg-destructive/5 border-destructive/20" 
        : "bg-warning/5 border-warning/20"
    )}>
      <div className="flex items-start gap-2">
        {isCritical ? (
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "font-medium",
            isCritical ? "text-destructive" : "text-warning"
          )}>
            {slotName} — {isCritical ? "Critical failure" : "Warning"}
          </p>
          {details && (
            <p className="text-xs text-muted-foreground mt-0.5">{details}</p>
          )}
          {!hasSerial && isCritical && (
            <p className="text-xs text-muted-foreground/80 mt-1 italic">
              Serial unavailable — module needs replacement
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface DriveIssueProps {
  drive: ServerDrive;
}

export function DriveIssueDetail({ drive }: DriveIssueProps) {
  const isCritical = drive.health === "Critical" || drive.status === "Disabled";
  const isPredictive = drive.predicted_failure;
  
  // Extract bay number from slot or name
  const slotInfo = drive.slot || drive.name || "Unknown Drive";
  const bayMatch = slotInfo.match(/Bay\.?(\d+)/i) || slotInfo.match(/(\d+)/);
  const bayNumber = bayMatch ? `Bay ${bayMatch[1]}` : slotInfo;
  
  // Build detail line
  const details = [
    drive.media_type,
    drive.capacity_bytes ? `${(drive.capacity_bytes / (1024 ** 4)).toFixed(0)} TB` : null,
    drive.manufacturer,
  ].filter(Boolean).join(" • ");
  
  // Serial number status
  const hasSerial = drive.serial_number && drive.serial_number !== "Unknown";

  // Determine status message
  let statusMessage = "";
  if (isCritical) {
    statusMessage = "Critical failure — drive offline";
  } else if (isPredictive) {
    statusMessage = "Predictive failure — replace soon";
  } else {
    statusMessage = "Warning state";
  }

  const severity = isCritical ? "critical" : isPredictive ? "warning" : "warning";

  return (
    <div className={cn(
      "rounded-md p-2.5 text-sm border",
      severity === "critical" 
        ? "bg-destructive/5 border-destructive/20" 
        : "bg-warning/5 border-warning/20"
    )}>
      <div className="flex items-start gap-2">
        {severity === "critical" ? (
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "font-medium",
            severity === "critical" ? "text-destructive" : "text-warning"
          )}>
            {bayNumber} — {statusMessage}
          </p>
          {details && (
            <p className="text-xs text-muted-foreground mt-0.5">{details}</p>
          )}
          {!hasSerial && isCritical && (
            <p className="text-xs text-muted-foreground/80 mt-1 italic">
              Serial unavailable — drive needs replacement
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
