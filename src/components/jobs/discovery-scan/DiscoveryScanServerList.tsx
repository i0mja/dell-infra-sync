import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Circle, 
  ShieldX, 
  Filter,
  Server
} from "lucide-react";
import type { ServerResult } from "@/hooks/useDiscoveryScanProgress";

interface DiscoveryScanServerListProps {
  serverResults: ServerResult[];
  isRunning: boolean;
  maxHeight?: string;
}

export function DiscoveryScanServerList({
  serverResults,
  isRunning,
  maxHeight = "300px",
}: DiscoveryScanServerListProps) {
  if (serverResults.length === 0 && !isRunning) {
    return null;
  }

  const getStatusIcon = (status: ServerResult['status']) => {
    switch (status) {
      case 'synced':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'auth_failed':
        return <ShieldX className="h-4 w-4 text-destructive" />;
      case 'filtered':
        return <Filter className="h-4 w-4 text-muted-foreground" />;
      case 'port_check':
      case 'detecting':
      case 'authenticating':
      case 'syncing':
      case 'scp':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'pending':
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusLabel = (status: ServerResult['status']) => {
    switch (status) {
      case 'synced':
        return 'Synced';
      case 'auth_failed':
        return 'Auth Failed';
      case 'filtered':
        return 'Skipped';
      case 'port_check':
        return 'Port Check';
      case 'detecting':
        return 'Detecting';
      case 'authenticating':
        return 'Auth...';
      case 'syncing':
        return 'Syncing';
      case 'scp':
        return 'SCP Backup';
      case 'pending':
      default:
        return 'Pending';
    }
  };

  const getStatusBadgeVariant = (status: ServerResult['status']): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case 'synced':
        return 'secondary';
      case 'auth_failed':
        return 'destructive';
      case 'filtered':
        return 'outline';
      default:
        return 'default';
    }
  };

  // Group results by status for summary
  const statusCounts = serverResults.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const syncedCount = statusCounts['synced'] || 0;
  const authFailedCount = statusCounts['auth_failed'] || 0;
  const filteredCount = statusCounts['filtered'] || 0;
  const inProgressCount = serverResults.filter(r => 
    ['port_check', 'detecting', 'authenticating', 'syncing', 'scp'].includes(r.status)
  ).length;

  if (serverResults.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Waiting for server discovery...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">Server Status:</span>
        {syncedCount > 0 && (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            {syncedCount} synced
          </Badge>
        )}
        {inProgressCount > 0 && (
          <Badge variant="default" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {inProgressCount} in progress
          </Badge>
        )}
        {authFailedCount > 0 && (
          <Badge variant="destructive" className="gap-1">
            <ShieldX className="h-3 w-3" />
            {authFailedCount} auth failed
          </Badge>
        )}
        {filteredCount > 0 && (
          <Badge variant="outline" className="gap-1">
            <Filter className="h-3 w-3" />
            {filteredCount} skipped
          </Badge>
        )}
      </div>

      {/* Server list */}
      <ScrollArea className="border rounded-lg" style={{ maxHeight }}>
        <div className="divide-y">
          {serverResults.map((server, index) => (
            <div
              key={server.ip || index}
              className={cn(
                "flex items-center justify-between px-4 py-2.5 text-sm",
                server.status === 'synced' && "bg-success/5",
                server.status === 'auth_failed' && "bg-destructive/5",
                ['port_check', 'detecting', 'authenticating', 'syncing', 'scp'].includes(server.status) && "bg-primary/5"
              )}
            >
              {/* IP and model */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {getStatusIcon(server.status)}
                <span className="font-mono text-sm">{server.ip}</span>
                {server.model && (
                  <span className="text-muted-foreground truncate">
                    {server.model}
                    {server.serviceTag && ` (${server.serviceTag})`}
                  </span>
                )}
              </div>

              {/* Status and timing */}
              <div className="flex items-center gap-3 flex-shrink-0">
                {server.scpProgress !== undefined && server.status === 'scp' && (
                  <span className="text-xs text-muted-foreground">
                    SCP {server.scpProgress}%
                  </span>
                )}
                <Badge variant={getStatusBadgeVariant(server.status)}>
                  {getStatusLabel(server.status)}
                </Badge>
                {server.duration !== undefined && (
                  <span className="text-xs text-muted-foreground w-12 text-right">
                    {server.duration < 1 ? '<1s' : `${server.duration.toFixed(1)}s`}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
