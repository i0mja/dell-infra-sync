import { Cpu, MemoryStick, HardDrive, Network } from "lucide-react";
import type { Server } from "@/hooks/useServers";
import type { ServerDrive } from "@/hooks/useServerDrives";
import type { ServerNic } from "@/hooks/useServerNics";

interface ServerQuickStatsProps {
  server: Server;
  drives?: ServerDrive[];
  nics?: ServerNic[];
}

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="flex flex-col items-center p-2.5 rounded-lg bg-muted/50 border border-border/50">
      <Icon className="h-4 w-4 text-muted-foreground mb-1" />
      <span className="text-xs font-medium">{value}</span>
      {subValue && (
        <span className="text-[10px] text-muted-foreground">{subValue}</span>
      )}
    </div>
  );
}

export function ServerQuickStats({ server, drives, nics }: ServerQuickStatsProps) {
  // CPU display
  const cpuDisplay = server.cpu_count 
    ? `${server.cpu_count}x` 
    : "—";
  const cpuCores = server.cpu_cores_per_socket 
    ? `${server.cpu_cores_per_socket}c` 
    : undefined;

  // Memory display
  const memoryDisplay = server.memory_gb 
    ? `${server.memory_gb} GB` 
    : "—";

  // Storage display
  const driveCount = drives?.length ?? server.total_drives ?? 0;
  const totalTB = server.total_storage_tb;
  const storageDisplay = driveCount > 0 ? `${driveCount}` : "—";
  const storageSub = totalTB ? `${totalTB} TB` : driveCount > 0 ? "drives" : undefined;

  // NIC display
  const nicCount = nics?.length ?? 0;
  const nicDisplay = nicCount > 0 ? `${nicCount}` : "—";
  const nicSub = nicCount > 0 ? "ports" : undefined;

  return (
    <div className="grid grid-cols-4 gap-2">
      <StatCard icon={Cpu} label="CPU" value={cpuDisplay} subValue={cpuCores} />
      <StatCard icon={MemoryStick} label="Memory" value={memoryDisplay} />
      <StatCard icon={HardDrive} label="Storage" value={storageDisplay} subValue={storageSub} />
      <StatCard icon={Network} label="NICs" value={nicDisplay} subValue={nicSub} />
    </div>
  );
}
