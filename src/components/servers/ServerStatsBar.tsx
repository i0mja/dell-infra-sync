import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, RefreshCw, Users, Wrench } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ServerStatsBarProps {
  totalServers: number;
  onlineCount: number;
  offlineCount: number;
  unknownCount: number;
  incompleteCount: number;
  onAddServer: () => void;
  onRefreshAll: () => void;
  onManageGroups: () => void;
  onDiscovery: () => void;
  useJobExecutor: boolean;
}

export function ServerStatsBar({
  totalServers,
  onlineCount,
  offlineCount,
  unknownCount,
  incompleteCount,
  onAddServer,
  onRefreshAll,
  onManageGroups,
  onDiscovery,
  useJobExecutor,
}: ServerStatsBarProps) {
  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-4 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="font-medium text-muted-foreground">Total:</span>
            <span className="font-semibold truncate">{totalServers}</span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-green-600 dark:text-green-400">●</span>
            <span className="font-medium text-muted-foreground">Online:</span>
            <span className="font-semibold">{onlineCount}</span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-red-600 dark:text-red-400">●</span>
            <span className="font-medium text-muted-foreground">Offline:</span>
            <span className="font-semibold">{offlineCount}</span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-yellow-600 dark:text-yellow-400">●</span>
            <span className="font-medium text-muted-foreground">Unknown:</span>
            <span className="font-semibold">{unknownCount}</span>
          </div>
          {incompleteCount > 0 && (
            <>
              <div className="hidden h-4 w-px bg-border sm:block" />
              <div className="flex items-center gap-2 text-sm whitespace-nowrap">
                <span className="text-orange-600 dark:text-orange-400">⚠</span>
                <span className="font-medium text-muted-foreground">Incomplete:</span>
                <span className="font-semibold">{incompleteCount}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onAddServer}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Server
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add a new server manually</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onRefreshAll}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh All
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh all server information</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onManageGroups}>
                  <Users className="h-4 w-4 mr-2" />
                  Groups
                </Button>
              </TooltipTrigger>
              <TooltipContent>Manage server groups</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onDiscovery}>
                  <Wrench className="h-4 w-4 mr-2" />
                  Discovery
                </Button>
              </TooltipTrigger>
              <TooltipContent>Run network discovery scan</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Badge variant="outline" className="gap-2 sm:ml-2 sm:border-l sm:pl-2">
            <span className={`h-2 w-2 rounded-full ${useJobExecutor ? 'bg-blue-500' : 'bg-emerald-500'}`} />
            <span className="text-xs font-medium tracking-wide">
              {useJobExecutor ? "Job Executor" : "Cloud Mode"}
            </span>
          </Badge>
        </div>
      </div>
    </div>
  );
}
