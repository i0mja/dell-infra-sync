import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Zap, 
  Clock, 
  TrendingUp,
  Database,
  Server,
  Monitor
} from "lucide-react";
import { cn } from "@/lib/utils";

interface VCenterSyncPerformanceInsightsProps {
  details: any;
  startedAt: string | null;
  completedAt: string | null;
}

interface PhaseMetric {
  label: string;
  icon: React.ReactNode;
  count: number;
  durationMs?: number;
}

export const VCenterSyncPerformanceInsights = ({ 
  details, 
  startedAt, 
  completedAt 
}: VCenterSyncPerformanceInsightsProps) => {
  // Calculate total duration
  const totalDurationMs = startedAt && completedAt 
    ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
    : details?.sync_duration_ms || (details?.sync_duration_seconds ? details.sync_duration_seconds * 1000 : 0);
  
  // PropertyCollector stats
  const pcObjectCount = details?.property_collector_count || details?.objects_fetched || 0;
  const pcDurationMs = details?.property_collector_time_ms || 0;
  const pcRate = pcDurationMs > 0 ? Math.round((pcObjectCount / pcDurationMs) * 1000) : 0;
  
  // Entity counts
  const vms = details?.vms_synced || details?.vms_processed || details?.vms || 0;
  const hosts = details?.hosts_synced || details?.updated_hosts || details?.hosts || 0;
  const datastores = details?.datastores_synced || details?.datastores || 0;
  const networks = details?.networks_synced || details?.networks || 0;
  const clusters = details?.clusters_synced || details?.clusters || 0;
  
  // Calculate sync rate
  const totalEntities = vms + hosts + datastores + networks + clusters;
  const syncRate = totalDurationMs > 0 
    ? Math.round((totalEntities / totalDurationMs) * 1000) 
    : 0;
  
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };
  
  // Phase breakdown (estimated based on entity counts)
  const phases: PhaseMetric[] = [
    { label: 'Clusters', icon: <Database className="h-4 w-4" />, count: clusters },
    { label: 'Hosts', icon: <Server className="h-4 w-4" />, count: hosts },
    { label: 'Datastores', icon: <Database className="h-4 w-4" />, count: datastores },
    { label: 'Networks', icon: <Database className="h-4 w-4" />, count: networks },
    { label: 'VMs', icon: <Monitor className="h-4 w-4" />, count: vms },
  ];
  
  // Calculate relative weights based on entity counts
  const maxCount = Math.max(...phases.map(p => p.count), 1);
  
  if (totalDurationMs === 0 && !pcObjectCount) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Performance Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Key Metrics Row */}
        <div className="grid grid-cols-3 gap-4">
          {/* Total Duration */}
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <Clock className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold">{formatDuration(totalDurationMs)}</p>
            <p className="text-xs text-muted-foreground">Total Duration</p>
          </div>
          
          {/* Entities Synced */}
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <Database className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold">{totalEntities.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Entities Synced</p>
          </div>
          
          {/* Sync Rate */}
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <TrendingUp className="h-5 w-5 mx-auto text-success mb-1" />
            <p className="text-lg font-bold">{syncRate}</p>
            <p className="text-xs text-muted-foreground">Entities/sec</p>
          </div>
        </div>
        
        {/* PropertyCollector Performance */}
        {pcObjectCount > 0 && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">PropertyCollector</span>
              </div>
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                Fast Mode
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Objects</p>
                <p className="font-medium">{pcObjectCount.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Fetch Time</p>
                <p className="font-medium">{formatDuration(pcDurationMs)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Rate</p>
                <p className="font-medium">{pcRate.toLocaleString()}/sec</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Phase Breakdown */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Entity Breakdown</p>
          {phases.filter(p => p.count > 0).map((phase) => (
            <div key={phase.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {phase.icon}
                  <span>{phase.label}</span>
                </div>
                <span className="font-mono text-muted-foreground">
                  {phase.count.toLocaleString()}
                </span>
              </div>
              <Progress 
                value={(phase.count / maxCount) * 100} 
                className={cn(
                  "h-1.5",
                  phase.label === 'VMs' && "bg-primary/20 [&>[role=progressbar]]:bg-primary"
                )}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
