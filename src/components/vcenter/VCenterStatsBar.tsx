import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings, Activity, RefreshCw, RefreshCcw, Loader2, Database, Link as LinkIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface VCenterStatsBarProps {
  totalHosts: number;
  linkedHosts: number;
  unlinkedHosts: number;
  lastSync: string | null;
  mode: 'job-executor' | 'cloud';
  syncing: boolean;
  testing: boolean;
  onSettings: () => void;
  onTest: () => void;
  onSync: () => void;
  onRefresh: () => void;
  onClusterUpdate: () => void;
  hasActiveClusters: boolean;
}

export function VCenterStatsBar({
  totalHosts,
  linkedHosts,
  unlinkedHosts,
  lastSync,
  mode,
  syncing,
  testing,
  onSettings,
  onTest,
  onSync,
  onRefresh,
  onClusterUpdate,
  hasActiveClusters,
}: VCenterStatsBarProps) {
  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Hosts:</span>
            <span className="font-semibold">{totalHosts}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <LinkIcon className="h-4 w-4 text-success" />
            <span className="text-muted-foreground">Linked:</span>
            <span className="font-semibold text-success">{linkedHosts}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <LinkIcon className="h-4 w-4 text-warning" />
            <span className="text-muted-foreground">Unlinked:</span>
            <span className="font-semibold text-warning">{unlinkedHosts}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex min-w-0 items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-muted-foreground">Last Sync:</span>
            <span className="font-semibold truncate max-w-[200px]">
              {lastSync ? formatDistanceToNow(new Date(lastSync), { addSuffix: true }) : 'Never'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={onSettings}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={testing}
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Activity className="mr-2 h-4 w-4" />
                Test
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onClusterUpdate}
            disabled={!hasActiveClusters}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Cluster Update
          </Button>

          <Button size="sm" onClick={onSync} disabled={syncing}>
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Sync Now
              </>
            )}
          </Button>

          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>

          <Badge variant="outline" className="gap-2 sm:ml-2 sm:border-l sm:pl-2">
            <span className={`h-2 w-2 rounded-full ${mode === 'job-executor' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
            <span className="text-xs font-medium tracking-wide">
              {mode === 'job-executor' ? 'Job Executor' : 'Cloud Mode'}
            </span>
          </Badge>
        </div>
      </div>
    </div>
  );
}
