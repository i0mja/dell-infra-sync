import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, RefreshCw, Users, Wrench, Settings } from "lucide-react";
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
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-muted-foreground">Total:</span>
            <span className="font-semibold">{totalServers}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-600 dark:text-green-400">●</span>
            <span className="font-medium text-muted-foreground">Online:</span>
            <span className="font-semibold">{onlineCount}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-red-600 dark:text-red-400">●</span>
            <span className="font-medium text-muted-foreground">Offline:</span>
            <span className="font-semibold">{offlineCount}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-yellow-600 dark:text-yellow-400">●</span>
            <span className="font-medium text-muted-foreground">Unknown:</span>
            <span className="font-semibold">{unknownCount}</span>
          </div>
          {incompleteCount > 0 && (
            <>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2 text-sm">
                <span className="text-orange-600 dark:text-orange-400">⚠</span>
                <span className="font-medium text-muted-foreground">Incomplete:</span>
                <span className="font-semibold">{incompleteCount}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
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

          <div className="ml-2 pl-2 border-l">
            <Badge variant={useJobExecutor ? "default" : "secondary"} className="gap-1">
              <span className={useJobExecutor ? "text-green-400" : "text-blue-400"}>●</span>
              {useJobExecutor ? "Job Executor" : "Cloud Mode"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
