import { Cpu, MemoryStick, HardDrive, Network } from "lucide-react";
import type { Server } from "@/hooks/useServers";
import type { ServerDrive } from "@/hooks/useServerDrives";
import type { ServerNic } from "@/hooks/useServerNics";
import type { ServerMemory } from "@/hooks/useServerMemory";
import { ServerHardwareRow } from "./ServerHardwareRow";
import { MemoryIssueDetail, DriveIssueDetail } from "./HardwareIssueDetails";

interface ServerHardwareSummaryListProps {
  server: Server;
  drives?: ServerDrive[];
  nics?: ServerNic[];
  memory?: ServerMemory[];
}

export function ServerHardwareSummaryList({ server, drives, nics, memory }: ServerHardwareSummaryListProps) {
  // Calculate CPU display
  const cpuCount = server.cpu_count || 0;
  const cpuCores = server.cpu_cores_per_socket || 0;
  const cpuDisplay = cpuCount > 0 && cpuCores > 0 
    ? `${cpuCount}x ${cpuCores} Cores` 
    : cpuCount > 0 
      ? `${cpuCount} CPUs` 
      : "—";

  // Calculate Memory display
  const memoryGB = server.memory_gb || 0;
  const memoryDisplay = memoryGB > 0 ? `${memoryGB} GB Memory` : "—";

  // Calculate Storage display
  const driveCount = drives?.length || server.total_drives || 0;
  const storageTB = server.total_storage_tb || 0;
  const storageDisplay = driveCount > 0 
    ? `${driveCount} Drives / ${storageTB.toFixed(2)} TB` 
    : storageTB > 0 
      ? `${storageTB.toFixed(2)} TB` 
      : "—";

  // Calculate Network display
  const nicCount = nics?.length || 0;
  const networkDisplay = nicCount > 0 ? `${nicCount} Network Ports` : "—";

  // Find memory issues (health != OK or status = Disabled)
  const memoryIssues = memory?.filter(m => 
    (m.health && m.health !== "OK") || m.status === "Disabled"
  ) || [];
  const memoryHasCritical = memoryIssues.some(m => m.health === "Critical" || m.status === "Disabled");
  const memorySeverity = memoryHasCritical ? "critical" : memoryIssues.length > 0 ? "warning" : "ok";

  // Find drive issues (health != OK or status = Disabled or predicted_failure)
  const driveIssues = drives?.filter(d => 
    (d.health && d.health !== "OK") || d.status === "Disabled" || d.predicted_failure
  ) || [];
  const driveHasCritical = driveIssues.some(d => d.health === "Critical" || d.status === "Disabled");
  const driveSeverity = driveHasCritical ? "critical" : driveIssues.length > 0 ? "warning" : "ok";

  return (
    <div className="space-y-1">
      {/* CPU - no expandable issues for now */}
      <ServerHardwareRow
        icon={Cpu}
        iconColor="text-blue-500"
        value={cpuDisplay}
      />

      {/* Memory - expandable if issues */}
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

      {/* Drives - expandable if issues */}
      <ServerHardwareRow
        icon={HardDrive}
        iconColor="text-amber-500"
        value={storageDisplay}
        issueCount={driveIssues.length}
        severity={driveSeverity}
      >
        {driveIssues.map((drive) => (
          <DriveIssueDetail key={drive.id} drive={drive} />
        ))}
      </ServerHardwareRow>

      {/* Network - no expandable issues for now */}
      <ServerHardwareRow
        icon={Network}
        iconColor="text-emerald-500"
        value={networkDisplay}
      />
    </div>
  );
}
