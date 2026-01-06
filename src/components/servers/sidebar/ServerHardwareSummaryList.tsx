import { Cpu, MemoryStick, HardDrive, Network } from "lucide-react";
import type { Server } from "@/hooks/useServers";
import type { ServerDrive } from "@/hooks/useServerDrives";
import type { ServerNic } from "@/hooks/useServerNics";

interface ServerHardwareSummaryListProps {
  server: Server;
  drives?: ServerDrive[];
  nics?: ServerNic[];
}

export function ServerHardwareSummaryList({ server, drives, nics }: ServerHardwareSummaryListProps) {
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

  const items = [
    { icon: Cpu, value: cpuDisplay, color: "text-blue-500" },
    { icon: MemoryStick, value: memoryDisplay, color: "text-purple-500" },
    { icon: HardDrive, value: storageDisplay, color: "text-amber-500" },
    { icon: Network, value: networkDisplay, color: "text-emerald-500" },
  ];

  return (
    <div className="space-y-1">
      {items.map((item, index) => (
        <div
          key={index}
          className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors"
        >
          <item.icon className={`h-4 w-4 ${item.color} flex-shrink-0`} />
          <span className="text-sm text-foreground">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
