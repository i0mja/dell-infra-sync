import { TrendingUp, TrendingDown, Minus, RefreshCw, Gauge } from "lucide-react";
import { useFleetHealth } from "@/hooks/useFleetHealth";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const DashboardHeader = () => {
  const { data: health, isLoading, isRefetching } = useFleetHealth();
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['fleet-health-score'] });
    queryClient.invalidateQueries({ queryKey: ['servers-count'] });
    queryClient.invalidateQueries({ queryKey: ['clusters-count'] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-16 w-32" />
      </div>
    );
  }

  const TrendIcon = health?.trend === 'up' ? TrendingUp : 
                   health?.trend === 'down' ? TrendingDown : Minus;
  
  const trendColor = health?.trend === 'up' ? 'text-green-500' : 
                    health?.trend === 'down' ? 'text-destructive' : 'text-muted-foreground';

  const scoreColor = (health?.score || 0) >= 90 ? 'text-green-500' : 
                    (health?.score || 0) >= 70 ? 'text-warning' : 'text-destructive';

  const ringColor = (health?.score || 0) >= 90 ? 'stroke-green-500' : 
                   (health?.score || 0) >= 70 ? 'stroke-amber-500' : 'stroke-destructive';

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Fleet Command Center</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>Infrastructure Operations Dashboard</span>
          <span className="text-border">•</span>
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "h-2 w-2 rounded-full animate-pulse",
              health?.totals.servers.online === health?.totals.servers.total 
                ? "bg-green-500" 
                : "bg-amber-500"
            )} />
            <span>
              {health?.lastSyncAt 
                ? `Synced ${formatDistanceToNow(health.lastSyncAt, { addSuffix: true })}`
                : 'No recent sync'
              }
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={handleRefresh}
          disabled={isRefetching}
          className="h-8 w-8"
        >
          <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-card border shadow-sm">
              {/* Health Score Ring */}
              <div className="relative h-12 w-12">
                <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
                  <circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="none"
                    className="stroke-muted"
                    strokeWidth="3"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="none"
                    className={cn(ringColor, "transition-all duration-500")}
                    strokeWidth="3"
                    strokeDasharray={`${(health?.score || 0) * 0.94} 94`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              <div className="text-right">
                <div className="flex items-center gap-1">
                  <span className={cn("text-2xl font-bold tabular-nums", scoreColor)}>
                    {health?.score || 0}
                  </span>
                  <TrendIcon className={cn("h-4 w-4", trendColor)} />
                </div>
                <div className="text-xs text-muted-foreground">Fleet Health</div>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="w-64">
            <div className="space-y-2">
              <div className="font-medium">Health Score Breakdown</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Server Connectivity</div>
                <div className="text-right font-medium">{health?.metrics.serverConnectivity}%</div>
                <div>Cluster Health</div>
                <div className="text-right font-medium">{health?.metrics.clusterHealth}%</div>
                <div>Alert Score</div>
                <div className="text-right font-medium">{health?.metrics.alertScore}%</div>
                <div>API Success Rate</div>
                <div className="text-right font-medium">{health?.metrics.apiSuccessRate}%</div>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
