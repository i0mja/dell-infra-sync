import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, RefreshCw, Activity, Server, AlertCircle } from "lucide-react";

interface ServerStatsBarProps {
  totalServers: number;
  onlineCount: number;
  offlineCount: number;
  unknownCount: number;
  incompleteCount: number;
  credentialCoverage: number;
  useJobExecutor: boolean;
  onAddServer: () => void;
  onRefreshAll: () => void;
  onDiscovery: () => void;
  onBulkRefresh?: () => void;
  bulkRefreshing?: boolean;
}

export function ServerStatsBar({
  totalServers,
  onlineCount,
  offlineCount,
  unknownCount,
  incompleteCount,
  credentialCoverage,
  useJobExecutor,
  onAddServer,
  onRefreshAll,
  onDiscovery,
  onBulkRefresh,
  bulkRefreshing = false,
}: ServerStatsBarProps) {
  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Total:</span>
            <span className="font-semibold">{totalServers}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-success" />
            <span className="text-muted-foreground">Online:</span>
            <span className="font-semibold text-success">{onlineCount}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-destructive" />
            <span className="text-muted-foreground">Offline:</span>
            <span className="font-semibold text-destructive">{offlineCount}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            <span className="text-muted-foreground">Unknown:</span>
            <span className="font-semibold">{unknownCount}</span>
          </div>

          {incompleteCount > 0 && (
            <>
              <div className="hidden h-4 w-px bg-border sm:block" />
              <div className="flex items-center gap-2 text-sm whitespace-nowrap">
                <AlertCircle className="h-4 w-4 text-warning" />
                <span className="text-muted-foreground">Incomplete:</span>
                <span className="font-semibold text-warning">{incompleteCount}</span>
              </div>
            </>
          )}

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-muted-foreground">Credentials:</span>
            <span className="font-semibold">
              {credentialCoverage}/{totalServers}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={onRefreshAll}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh All
          </Button>

          {onBulkRefresh && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onBulkRefresh}
              disabled={bulkRefreshing || totalServers === 0}
            >
              <Activity className="mr-2 h-4 w-4" />
              {bulkRefreshing ? "Refreshing..." : "Refresh from iDRAC"}
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={onDiscovery}>
            <Activity className="mr-2 h-4 w-4" />
            Discovery
          </Button>

          <Button size="sm" onClick={onAddServer}>
            <Plus className="mr-2 h-4 w-4" />
            Add Server
          </Button>

          <Badge variant="outline" className="gap-2 sm:ml-2 sm:border-l sm:pl-2">
            <span
              className={`h-2 w-2 rounded-full ${
                useJobExecutor ? "bg-blue-500" : "bg-emerald-500"
              }`}
            />
            <span className="text-xs font-medium tracking-wide">
              {useJobExecutor ? "Job Executor" : "Cloud Mode"}
            </span>
          </Badge>
        </div>
      </div>
    </div>
  );
}
