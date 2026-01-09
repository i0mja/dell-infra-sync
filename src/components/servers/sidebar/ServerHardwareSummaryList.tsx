import { useMemo } from "react";
import { Cpu, MemoryStick, HardDrive, Network } from "lucide-react";
import type { Server } from "@/hooks/useServers";
import type { ServerDrive } from "@/hooks/useServerDrives";
import type { ServerNic } from "@/hooks/useServerNics";
import type { ServerMemory } from "@/hooks/useServerMemory";
import { ServerHardwareRow } from "./ServerHardwareRow";
import { MemoryIssueDetail, DriveIssueDetail } from "./HardwareIssueDetails";
import { isDriveCritical, hasDriveIssue } from "@/lib/driveHealth";
import { formatSpeedShort } from "@/lib/nic-utils";

interface ServerHardwareSummaryListProps {
  server: Server;
  drives?: ServerDrive[];
  nics?: ServerNic[];
  memory?: ServerMemory[];
}

/**
 * Shortens Intel/AMD CPU model names for compact display
 * e.g., "Intel(R) Xeon(R) Gold 5315Y CPU @ 2.40GHz" → "Xeon Gold 5315Y @ 2.40GHz"
 */
function formatCpuModel(cpuModel: string | null, cpuSpeed: string | null): string {
  if (!cpuModel) return '';
  
  let short = cpuModel
    .replace(/Intel\(R\)\s*/gi, '')
    .replace(/AMD\s*/gi, '')
    .replace(/Xeon\(R\)\s*/gi, 'Xeon ')
    .replace(/\s*CPU\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // If model already has speed, don't add it again
  if (short.includes('@') || !cpuSpeed) {
    return short;
  }
  
  return `${short} @ ${cpuSpeed}`;
}

export function ServerHardwareSummaryList({ server, drives, nics, memory }: ServerHardwareSummaryListProps) {
  // === CPU Display ===
  const cpuCount = server.cpu_count || 0;
  const cpuCores = server.cpu_cores_per_socket || 0;
  const cpuModel = formatCpuModel(server.cpu_model, server.cpu_speed);
  
  const cpuDisplay = cpuCount > 0 && cpuModel
    ? `${cpuCount}x ${cpuModel} (${cpuCores}c)`
    : cpuCount > 0 && cpuCores > 0 
      ? `${cpuCount}x ${cpuCores} Cores` 
      : "—";

  // === Memory Display ===
  const memoryGB = server.memory_gb || 0;
  const activeMemory = memory?.filter(m => m.status !== 'Absent') || [];
  const memoryType = activeMemory.find(m => m.memory_type)?.memory_type;
  const memorySpeed = activeMemory.find(m => m.speed_mhz)?.speed_mhz;
  const dimmCount = activeMemory.length;
  
  const memoryDisplay = memoryGB > 0 
    ? `${memoryGB} GB${memoryType ? ` ${memoryType}` : ''}${memorySpeed ? ` @ ${memorySpeed} MHz` : ''}${dimmCount > 0 ? ` (${dimmCount} DIMMs)` : ''}`
    : "—";

  // === Storage Display ===
  const driveCount = drives?.length || server.total_drives || 0;
  const storageTB = server.total_storage_tb || 0;
  const ssdCount = drives?.filter(d => d.media_type === 'SSD')?.length || 0;
  const hddCount = drives?.filter(d => d.media_type === 'HDD')?.length || 0;
  
  const mediaBreakdown: string[] = [];
  if (ssdCount > 0) mediaBreakdown.push(`${ssdCount} SSD`);
  if (hddCount > 0) mediaBreakdown.push(`${hddCount} HDD`);
  
  const storageDisplay = driveCount > 0 
    ? `${driveCount} Drives / ${storageTB.toFixed(2)} TB${mediaBreakdown.length > 0 ? ` • ${mediaBreakdown.join(', ')}` : ''}`
    : storageTB > 0 
      ? `${storageTB.toFixed(2)} TB` 
      : "—";

  // === Network Display ===
  const nicCount = nics?.length || 0;
  const activeNics = nics?.filter(n => 
    n.link_status?.toLowerCase() === 'linkup' || 
    n.link_status?.toLowerCase() === 'up'
  ) || [];
  
  // Group active NICs by speed for summary
  const speedGroups: Record<string, number> = {};
  activeNics.forEach(n => {
    if (n.current_speed_mbps && n.current_speed_mbps > 0) {
      const speedLabel = formatSpeedShort(n.current_speed_mbps, n.model);
      if (speedLabel) {
        speedGroups[speedLabel] = (speedGroups[speedLabel] || 0) + 1;
      }
    }
  });
  
  const speedSummary = Object.entries(speedGroups)
    .sort((a, b) => b[1] - a[1]) // Most common first
    .map(([speed, count]) => `${count}x ${speed}`)
    .join(', ');
  
  const networkDisplay = nicCount > 0
    ? `${nicCount} Ports • ${activeNics.length} Active${speedSummary ? ` (${speedSummary})` : ''}`
    : "—";

  // === Memory Issues ===
  const memoryIssues = memory?.filter(m => 
    (m.health && m.health !== "OK") || m.status === "Disabled"
  ) || [];
  const memoryHasCritical = memoryIssues.some(m => m.health === "Critical" || m.status === "Disabled");
  const memorySeverity = memoryHasCritical ? "critical" : memoryIssues.length > 0 ? "warning" : "ok";

  // === Drive Issues ===
  const driveIssues = drives?.filter(d => 
    hasDriveIssue(d) || (d.health && d.health !== "OK")
  ) || [];
  const driveHasCritical = driveIssues.some(d => isDriveCritical(d));
  const driveSeverity = driveHasCritical ? "critical" : driveIssues.length > 0 ? "warning" : "ok";

  // Build model -> part number lookup for fallback on failed drives
  const modelToPartNumber = useMemo(() => {
    const lookup: Record<string, string> = {};
    drives?.forEach(d => {
      if (d.model && d.part_number && !lookup[d.model]) {
        lookup[d.model] = d.part_number;
      }
    });
    return lookup;
  }, [drives]);

  return (
    <div className="space-y-1">
      {/* CPU */}
      <ServerHardwareRow
        icon={Cpu}
        iconColor="text-blue-500"
        value={cpuDisplay}
      />

      {/* Memory */}
      <ServerHardwareRow
        icon={MemoryStick}
        iconColor="text-purple-500"
        value={memoryDisplay}
        issueCount={memoryIssues.length}
        severity={memorySeverity}
      >
        {memoryIssues.map((mem) => (
          <MemoryIssueDetail key={mem.id} memory={mem} />
        ))}
      </ServerHardwareRow>

      {/* Drives */}
      <ServerHardwareRow
        icon={HardDrive}
        iconColor="text-amber-500"
        value={storageDisplay}
        issueCount={driveIssues.length}
        severity={driveSeverity}
      >
        {driveIssues.map((drive) => (
          <DriveIssueDetail 
            key={drive.id} 
            drive={drive}
            inferredPartNumber={!drive.part_number ? modelToPartNumber[drive.model || ''] : undefined}
          />
        ))}
      </ServerHardwareRow>

      {/* Network */}
      <ServerHardwareRow
        icon={Network}
        iconColor="text-emerald-500"
        value={networkDisplay}
      />
    </div>
  );
}