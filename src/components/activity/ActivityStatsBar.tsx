import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, BarChart3, CheckCircle2, Download, RefreshCw, Zap } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ActivityStatsBarProps {
  totalCommands: number;
  successRate: number;
  activeJobs: number;
  failedCount: number;
  liveStatus: 'connecting' | 'connected' | 'disconnected';
  onRefresh: () => void;
  onExportCSV: () => void;
  onExportJSON: () => void;
}

export const ActivityStatsBar = ({
  totalCommands,
  successRate,
  activeJobs,
  failedCount,
  liveStatus,
  onRefresh,
  onExportCSV,
  onExportJSON
}: ActivityStatsBarProps) => {
  const statusColors = {
    connecting: 'bg-yellow-500',
    connected: 'bg-green-500',
    disconnected: 'bg-red-500'
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
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Commands:</span>
            <span className="font-semibold">{totalCommands.toLocaleString()}</span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex items-center gap-2 whitespace-nowrap">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">Success:</span>
            <span className="font-semibold">{successRate.toFixed(1)}%</span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex items-center gap-2 whitespace-nowrap">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Live Jobs:</span>
            <span className="font-semibold">{activeJobs}</span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex items-center gap-2 whitespace-nowrap">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-muted-foreground">Failed:</span>
            <span className="font-semibold text-destructive">{failedCount}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onExportCSV}>
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportJSON}>
                Export as JSON (Full Details)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Badge variant="outline" className="gap-2 sm:ml-2 sm:border-l sm:pl-2">
            <span className={`h-2 w-2 rounded-full ${statusColors[liveStatus]} animate-pulse`} />
            <span className="text-xs font-medium tracking-wide">
              {statusLabels[liveStatus]}
            </span>
          </Badge>
        </div>
      </div>
    </div>
  );
};
