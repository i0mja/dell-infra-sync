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
      <div className="flex flex-col gap-2 px-3 py-2 sm:px-4 lg:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Total:</span>
            <span className="font-semibold">{totalServers}</span>
          </div>

          <div className="hidden h-3 w-px bg-border sm:block" />

          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            <span className="text-muted-foreground">Online:</span>
            <span className="font-semibold text-success">{onlineCount}</span>
          </div>

          <div className="hidden h-3 w-px bg-border sm:block" />

          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
            <span className="text-muted-foreground">Offline:</span>
            <span className="font-semibold text-destructive">{offlineCount}</span>
          </div>

          <div className="hidden h-3 w-px bg-border sm:block" />

          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <span className="text-muted-foreground">Unknown:</span>
            <span className="font-semibold">{unknownCount}</span>
          </div>

          {incompleteCount > 0 && (
            <>
              <div className="hidden h-3 w-px bg-border sm:block" />
              <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                <AlertCircle className="h-3.5 w-3.5 text-warning" />
                <span className="text-muted-foreground">Incomplete:</span>
                <span className="font-semibold text-warning">{incompleteCount}</span>
              </div>
            </>
          )}

          <div className="hidden h-3 w-px bg-border sm:block" />

          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <span className="text-muted-foreground">Creds:</span>
            <span className="font-semibold">
              {credentialCoverage}/{totalServers}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
          <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={onRefreshAll}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>

          {onBulkRefresh && (
            <Button 
              variant="outline" 
              size="sm"
              className="h-7 text-xs px-2"
              onClick={onBulkRefresh}
              disabled={bulkRefreshing || totalServers === 0}
            >
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              {bulkRefreshing ? "..." : "iDRAC"}
            </Button>
          )}

          <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={onDiscovery}>
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            Discover
          </Button>

          <Button size="sm" className="h-7 text-xs px-2" onClick={onAddServer}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add
          </Button>

          <Badge variant="outline" className="gap-1.5 text-xs h-7 sm:ml-1">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                useJobExecutor ? "bg-blue-500" : "bg-emerald-500"
              }`}
            />
            <span className="font-medium">
              {useJobExecutor ? "Executor" : "Cloud"}
            </span>
          </Badge>
        </div>
      </div>
    </div>
  );
}
