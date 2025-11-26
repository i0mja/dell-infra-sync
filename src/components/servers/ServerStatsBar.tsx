import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";

interface ServerStatsBarProps {
  totalServers: number;
  onlineCount: number;
  offlineCount: number;
  unknownCount: number;
  incompleteCount: number;
  useJobExecutor: boolean;
}

export function ServerStatsBar({
  totalServers,
  onlineCount,
  offlineCount,
  unknownCount,
  incompleteCount,
  useJobExecutor,
}: ServerStatsBarProps) {
  const statItems = [
    {
      label: "Total",
      value: totalServers,
      dotClass: "bg-primary",
    },
    {
      label: "Online",
      value: onlineCount,
      dotClass: "bg-green-500",
    },
    {
      label: "Offline",
      value: offlineCount,
      dotClass: "bg-red-500",
    },
    {
      label: "Unknown",
      value: unknownCount,
      dotClass: "bg-yellow-500",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-background/80 p-3 shadow-sm">
      {statItems.map((item) => (
        <div key={item.label} className="flex items-center gap-2 rounded border border-transparent px-2 py-1 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${item.dotClass}`} />
          <span className="text-muted-foreground">{item.label}:</span>
          <span className="font-semibold text-foreground">{item.value}</span>
        </div>
      ))}

      {incompleteCount > 0 && (
        <div className="flex items-center gap-2 rounded border border-amber-200/50 bg-amber-50/50 px-2 py-1 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
          <span className="text-amber-600 dark:text-amber-400">⚠</span>
          <span className="text-muted-foreground">Incomplete:</span>
          <span className="font-semibold text-foreground">{incompleteCount}</span>
        </div>
      )}

      <Badge variant="secondary" className="gap-2 border-dashed bg-background text-xs uppercase tracking-wide">
        <Activity className="h-3.5 w-3.5" />
        {useJobExecutor ? "Job Executor-first" : "Cloud mode"}
      </Badge>
    </div>
  );
}
