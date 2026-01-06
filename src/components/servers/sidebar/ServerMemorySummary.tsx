import { MemoryStick, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ServerMemory } from "@/hooks/useServerMemory";
import { useServerMemory } from "@/hooks/useServerMemory";
import { CollapsibleSection } from "./CollapsibleSection";

interface ServerMemorySummaryProps {
  server: {
    id: string;
    hostname: string;
  };
}

function DimmHealthIcon({ dimm }: { dimm: ServerMemory }) {
  if (dimm.health === "Critical" || dimm.status === "Disabled") {
    return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  }
  if (dimm.health === "OK" && dimm.status === "Enabled") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  }
  if (dimm.health === "Warning") {
    return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
  }
  return <MemoryStick className="h-3.5 w-3.5 text-muted-foreground" />;
}

function formatCapacity(capacityMb: number): string {
  if (capacityMb >= 1024) {
    return `${(capacityMb / 1024).toFixed(0)} GB`;
  }
  return `${capacityMb} MB`;
}

export function ServerMemorySummary({ server }: ServerMemorySummaryProps) {
  const { data: dimms, isLoading, error } = useServerMemory(server.id);

  if (isLoading) {
    return (
      <CollapsibleSection icon={MemoryStick} title="Memory" count="...">
        <div className="text-xs text-muted-foreground animate-pulse">Loading memory info...</div>
      </CollapsibleSection>
    );
  }

  if (error || !dimms || dimms.length === 0) {
    return (
      <CollapsibleSection icon={MemoryStick} title="Memory" count="0">
        <div className="text-xs text-muted-foreground">
          {error ? "Failed to load memory info" : "No memory information available"}
        </div>
      </CollapsibleSection>
    );
  }

  // Calculate health summary
  const criticalCount = dimms.filter(d => 
    d.health === "Critical" || d.status === "Disabled"
  ).length;
  const healthyCount = dimms.filter(d => 
    d.health === "OK" && d.status === "Enabled"
  ).length;
  const warningCount = dimms.filter(d => 
    d.health === "Warning" && d.status !== "Disabled"
  ).length;

  // Calculate total capacity (only from enabled DIMMs)
  const totalCapacityMb = dimms
    .filter(d => d.status === "Enabled" && d.capacity_mb)
    .reduce((sum, d) => sum + (d.capacity_mb || 0), 0);

  // Sort to show critical/warning first
  const sortedDimms = [...dimms].sort((a, b) => {
    const aScore = (a.health === "Critical" || a.status === "Disabled") ? 0 : 
                   (a.health === "Warning") ? 1 : 2;
    const bScore = (b.health === "Critical" || b.status === "Disabled") ? 0 : 
                   (b.health === "Warning") ? 1 : 2;
    if (aScore !== bScore) return aScore - bScore;
    return (a.slot_name || a.dimm_identifier).localeCompare(b.slot_name || b.dimm_identifier);
  });

  // Count display for header
  const countDisplay = `${dimms.length} DIMMs`;
  const summaryDisplay = totalCapacityMb > 0 ? formatCapacity(totalCapacityMb) : undefined;

  // Health badges for header
  const headerContent = (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-success flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {healthyCount}
      </span>
      {criticalCount > 0 && (
        <span className="text-destructive flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          {criticalCount}
        </span>
      )}
      {warningCount > 0 && (
        <span className="text-warning flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {warningCount}
        </span>
      )}
    </div>
  );

  return (
    <CollapsibleSection 
      icon={MemoryStick} 
      title="Memory" 
      count={countDisplay}
      summary={summaryDisplay}
      defaultOpen={false}
      headerContent={headerContent}
    >
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {sortedDimms.map((dimm) => (
          <div
            key={dimm.id}
            className="flex items-start gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-xs"
          >
            <div className="flex-shrink-0 mt-0.5">
              <DimmHealthIcon dimm={dimm} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium truncate">
                  {dimm.slot_name ? `Slot ${dimm.slot_name}` : dimm.dimm_identifier}
                </span>
                {dimm.memory_type && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                    {dimm.memory_type}
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground flex items-center gap-1 flex-wrap">
                {dimm.capacity_mb && <span>{formatCapacity(dimm.capacity_mb)}</span>}
                {dimm.manufacturer && <span>• {dimm.manufacturer}</span>}
                {dimm.operating_speed_mhz && <span>• {dimm.operating_speed_mhz} MHz</span>}
              </div>
              {/* Critical/Disabled status */}
              {(dimm.health === "Critical" || dimm.status === "Disabled") && (
                <div className="flex items-center gap-1 mt-1 text-destructive">
                  <XCircle className="h-3 w-3" />
                  <span className="text-[10px] font-medium">
                    {dimm.health === "Critical" ? "Critical failure" : "Disabled - DIMM offline"}
                  </span>
                </div>
              )}
              {/* Missing serial number warning for failed DIMMs */}
              {!dimm.serial_number && (dimm.health === "Critical" || dimm.status === "Disabled") && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Serial number unavailable (module may need replacement)
                </div>
              )}
              {/* Warning status */}
              {dimm.health === "Warning" && dimm.status !== "Disabled" && (
                <div className="flex items-center gap-1 mt-1 text-warning">
                  <AlertTriangle className="h-3 w-3" />
                  <span className="text-[10px] font-medium">Warning state</span>
                </div>
              )}
              {/* Serial number for healthy DIMMs */}
              {dimm.serial_number && dimm.health !== "Critical" && dimm.status !== "Disabled" && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  SN: {dimm.serial_number}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
