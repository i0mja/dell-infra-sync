import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, RefreshCw, Activity, Zap, ChevronDown, Settings } from "lucide-react";

interface PduStatsBarProps {
  totalPdus: number;
  onlineCount: number;
  offlineCount: number;
  unknownCount: number;
  errorCount: number;
  totalOutlets: number;
  useJobExecutor: boolean;
  onAddPdu: () => void;
  onRefreshAll: () => void;
  onSyncAll: () => void;
  onDiscoverAll: () => void;
  onPduSettings?: () => void;
  isSyncing?: boolean;
}

export function PduStatsBar({
  totalPdus,
  onlineCount,
  offlineCount,
  unknownCount,
  errorCount,
  totalOutlets,
  useJobExecutor,
  onAddPdu,
  onRefreshAll,
  onSyncAll,
  onDiscoverAll,
  onPduSettings,
  isSyncing = false,
}: PduStatsBarProps) {
  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-2 px-3 py-2 sm:px-4 lg:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Total:</span>
            <span className="font-semibold">{totalPdus}</span>
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

          {errorCount > 0 && (
            <>
              <div className="hidden h-3 w-px bg-border sm:block" />
              <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                <span className="text-muted-foreground">Error:</span>
                <span className="font-semibold text-warning">{errorCount}</span>
              </div>
            </>
          )}

          <div className="hidden h-3 w-px bg-border sm:block" />

          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <span className="text-muted-foreground">Outlets:</span>
            <span className="font-semibold">{totalOutlets}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
          <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={onRefreshAll}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                className="h-7 text-xs px-2"
                disabled={isSyncing}
              >
                <Activity className="mr-1.5 h-3.5 w-3.5" />
                {isSyncing ? "..." : "PDU"}
                <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                onClick={onSyncAll}
                disabled={totalPdus === 0}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Sync All PDUs
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={onDiscoverAll}
                disabled={totalPdus === 0}
              >
                <Activity className="mr-2 h-3.5 w-3.5" />
                Discover All
              </DropdownMenuItem>
              {onPduSettings && (
                <DropdownMenuItem onClick={onPduSettings}>
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  PDU Settings
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" className="h-7 text-xs px-2" onClick={onAddPdu}>
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
