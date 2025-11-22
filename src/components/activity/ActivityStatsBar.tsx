import { RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ActivityStatsBarProps {
  totalCommands: number;
  successRate: number;
  activeJobs: number;
  failedCount: number;
  liveStatus: 'connecting' | 'connected' | 'disconnected';
  onRefresh: () => void;
  onExport: () => void;
}

export const ActivityStatsBar = ({
  totalCommands,
  successRate,
  activeJobs,
  failedCount,
  liveStatus,
  onRefresh,
  onExport
}: ActivityStatsBarProps) => {
  const statusColors = {
    connecting: 'text-yellow-500',
    connected: 'text-green-500',
    disconnected: 'text-red-500'
  };

  const statusLabels = {
    connecting: 'CONNECTING',
    connected: 'LIVE',
    disconnected: 'OFFLINE'
  };

  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm sm:gap-6">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-muted-foreground">📊 Commands:</span>
            <span className="font-medium truncate max-w-[120px]">
              {totalCommands.toLocaleString()}
            </span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
            <span className="text-muted-foreground">✓ Success:</span>
            <span className="font-medium truncate max-w-[96px]">
              {successRate.toFixed(1)}%
            </span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
            <span className="text-muted-foreground">⚡ Live Jobs:</span>
            <span className="font-medium truncate max-w-[96px]">{activeJobs}</span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
            <span className="text-muted-foreground">🔴 Failed:</span>
            <span className="font-medium text-destructive truncate max-w-[96px]">
              {failedCount}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="ghost" size="sm" onClick={onRefresh} className="h-8">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onExport} className="h-8">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <div className="flex items-center gap-2 sm:ml-2 sm:border-l sm:pl-2">
            <div className={`h-2 w-2 rounded-full ${statusColors[liveStatus]} animate-pulse`} />
            <span className={`text-xs font-medium ${statusColors[liveStatus]}`}>
              {statusLabels[liveStatus]}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
