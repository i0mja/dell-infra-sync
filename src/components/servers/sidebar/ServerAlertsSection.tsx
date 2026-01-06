import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ServerAlertsSectionProps {
  serverId: string;
}

interface HealthEvent {
  id: string;
  component_type: string;
  severity: "Critical" | "Warning";
  message: string;
  created_at: string;
}

// Extract bay number from drive_identifier for human-readable display
function extractBayFromIdentifier(driveId: string | null): string {
  if (!driveId) return "Drive";
  
  // Pattern: loc:RAID.SL.3-1:9:Disk.Bay.9:... -> Bay 9
  const bayMatch = driveId.match(/Disk\.Bay\.(\d+)/);
  if (bayMatch) return `Bay ${bayMatch[1]}`;
  
  // Pattern with slot number: loc:RAID...:9:... -> Bay 9
  const slotMatch = driveId.match(/loc:[^:]+:(\d+):/);
  if (slotMatch) return `Bay ${slotMatch[1]}`;
  
  // Pattern: sn:SERIALNUMBER -> just show "Drive"
  if (driveId.startsWith("sn:")) return "Drive";
  
  return "Drive";
}

export function ServerAlertsSection({ serverId }: ServerAlertsSectionProps) {
  // Query recent health events/warnings for this server
  const { data: alerts } = useQuery({
    queryKey: ["server-alerts", serverId],
    queryFn: async () => {
      // Check for drives with non-OK health or predicted failure
      const { data: driveAlerts } = await supabase
        .from("server_drives")
        .select("id, drive_identifier, slot, health, predicted_failure, created_at")
        .eq("server_id", serverId)
        .or("health.neq.OK,predicted_failure.eq.true")
        .order("created_at", { ascending: false })
        .limit(3);

      // Check for memory with non-OK health
      const { data: memoryAlerts } = await supabase
        .from("server_memory")
        .select("id, slot_name, health, created_at")
        .eq("server_id", serverId)
        .neq("health", "OK")
        .order("created_at", { ascending: false })
        .limit(3);

      const events: HealthEvent[] = [];

      // Convert drive issues to alerts
      driveAlerts?.forEach((drive) => {
        // Use slot if available, otherwise parse from drive_identifier
        const bayDisplay = drive.slot != null 
          ? `Bay ${drive.slot}` 
          : extractBayFromIdentifier(drive.drive_identifier);
        
        // Only add if there's an actual issue
        if (drive.predicted_failure) {
          events.push({
            id: `drive-${drive.id}`,
            component_type: "Drive",
            severity: "Warning",
            message: `${bayDisplay} - Predictive failure detected`,
            created_at: drive.created_at,
          });
        } else if (drive.health && drive.health !== "OK") {
          events.push({
            id: `drive-${drive.id}`,
            component_type: "Drive",
            severity: drive.health === "Critical" ? "Critical" : "Warning",
            message: `${bayDisplay} - ${drive.health} failure`,
            created_at: drive.created_at,
          });
        }
      });

      // Convert memory issues to alerts
      memoryAlerts?.forEach((mem) => {
        if (mem.health && mem.health !== "OK") {
          events.push({
            id: `mem-${mem.id}`,
            component_type: "Memory",
            severity: mem.health === "Critical" ? "Critical" : "Warning",
            message: `DIMM ${mem.slot_name || 'Slot'} - ${mem.health} failure`,
            created_at: mem.created_at,
          });
        }
      });

      return events.slice(0, 5);
    },
    staleTime: 30000,
  });

  if (!alerts || alerts.length === 0) {
    return (
      <div className="space-y-2">
        <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Alerts
        </h4>
        <div className="flex items-center gap-2 py-2 px-2 rounded-md bg-muted/30 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          <span>No active alerts</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        Alerts
      </h4>
      <div className="space-y-1.5">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="flex items-start gap-2 py-1.5 px-2 rounded-md bg-destructive/10 text-xs"
          >
            {alert.severity === "Critical" ? (
              <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-foreground truncate">{alert.message}</p>
            </div>
            <span className="text-muted-foreground flex-shrink-0">
              {formatDistanceToNow(new Date(alert.created_at), { addSuffix: false })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
