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
    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Hosts:</span>
            <span className="text-sm font-bold">{totalHosts}</span>
          </div>
          
          <div className="h-4 w-px bg-border" />
          
          <div className="flex items-center gap-2">
            <LinkIcon className="h-3.5 w-3.5 text-success" />
            <span className="text-sm text-muted-foreground">Linked:</span>
            <span className="text-sm font-medium text-success">{linkedHosts}</span>
          </div>
          
          <div className="h-4 w-px bg-border" />
          
          <div className="flex items-center gap-2">
            <LinkIcon className="h-3.5 w-3.5 text-warning" />
            <span className="text-sm text-muted-foreground">Unlinked:</span>
            <span className="text-sm font-medium text-warning">{unlinkedHosts}</span>
          </div>
          
          <div className="h-4 w-px bg-border" />
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Last Sync:</span>
            <span className="text-sm font-medium">
              {lastSync ? formatDistanceToNow(new Date(lastSync), { addSuffix: true }) : 'Never'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Activity className="h-4 w-4 mr-2" />
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
            <RefreshCw className="h-4 w-4" />
          </Button>

          <div className="ml-2 pl-2 border-l">
            <Badge variant={mode === 'job-executor' ? 'secondary' : 'default'} className="text-xs">
              {mode === 'job-executor' ? '⚙️ Job Executor' : '☁️ Cloud'}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
