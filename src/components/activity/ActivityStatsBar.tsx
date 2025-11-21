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
    <div className="border-b bg-card px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">📊 Commands:</span>
          <span className="font-medium">{totalCommands.toLocaleString()}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">✓ Success:</span>
          <span className="font-medium">{successRate.toFixed(1)}%</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">⚡ Live Jobs:</span>
          <span className="font-medium">{activeJobs}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">🔴 Failed:</span>
          <span className="font-medium text-destructive">{failedCount}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="h-8"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onExport}
          className="h-8"
        >
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
        <div className="flex items-center gap-2 ml-2">
          <div className={`h-2 w-2 rounded-full ${statusColors[liveStatus]} animate-pulse`} />
          <span className={`text-xs font-medium ${statusColors[liveStatus]}`}>
            {statusLabels[liveStatus]}
          </span>
        </div>
      </div>
    </div>
  );
};
