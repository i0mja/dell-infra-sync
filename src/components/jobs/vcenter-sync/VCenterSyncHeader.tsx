import { Badge } from "@/components/ui/badge";
import { Database, Clock, Zap, Server, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VCenterSyncHeaderProps {
  job: {
    status: string;
    started_at: string | null;
    completed_at: string | null;
    details: any;
  };
  elapsedMs?: number;
}

export const VCenterSyncHeader = ({ job, elapsedMs }: VCenterSyncHeaderProps) => {
  const details = job.details || {};
  const isRunning = job.status === 'running';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  
  // Multi-vCenter support
  const totalVcenters = details.total_vcenters || 1;
  const currentVcenterIndex = details.current_vcenter_index ?? 0;
  const currentVcenterName = details.current_vcenter_name || details.vcenter_name || details.vcenter_host;
  
  // Format elapsed time
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };
  
  // Calculate duration for completed jobs
  const getDuration = () => {
    if (elapsedMs) return formatDuration(elapsedMs);
    if (details.sync_duration_seconds) return `${details.sync_duration_seconds}s`;
    if (details.sync_duration_ms) return formatDuration(details.sync_duration_ms);
    if (job.started_at && job.completed_at) {
      const duration = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
      return formatDuration(duration);
    }
    return null;
  };
  
  const duration = getDuration();
  
  // Get PropertyCollector stats
  const objectsFetched = details.property_collector_count || details.objects_fetched;
  const fetchTime = details.property_collector_time_ms;
  
  const getStatusIcon = () => {
    if (isRunning) return <Loader2 className="h-5 w-5 animate-spin" />;
    if (isCompleted) return <CheckCircle className="h-5 w-5" />;
    if (isFailed) return <XCircle className="h-5 w-5" />;
    return <Clock className="h-5 w-5" />;
  };
  
  const getStatusColor = () => {
    if (isRunning) return "text-primary";
    if (isCompleted) return "text-success";
    if (isFailed) return "text-destructive";
    return "text-muted-foreground";
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Main header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", 
            isRunning && "bg-primary/10",
            isCompleted && "bg-success/10",
            isFailed && "bg-destructive/10",
            !isRunning && !isCompleted && !isFailed && "bg-muted"
          )}>
            <Database className={cn("h-5 w-5", getStatusColor())} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">vCenter Sync</h3>
              {currentVcenterName && (
                <Badge variant="secondary" className="font-normal max-w-[200px] truncate">
                  {currentVcenterName}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {isRunning ? 'Synchronizing inventory...' : 
               isCompleted ? 'Sync completed' : 
               isFailed ? 'Sync failed' : 
               'Pending'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Multi-vCenter indicator */}
          {totalVcenters > 1 && (
            <Badge variant="outline" className="font-mono">
              <Server className="h-3 w-3 mr-1" />
              {isRunning ? `${currentVcenterIndex + 1}/${totalVcenters}` : `${totalVcenters} vCenters`}
            </Badge>
          )}
          
          {/* Status badge */}
          <Badge 
            variant={isCompleted ? "secondary" : isFailed ? "destructive" : isRunning ? "default" : "outline"}
            className="flex items-center gap-1"
          >
            {getStatusIcon()}
            <span className="capitalize">{job.status}</span>
          </Badge>
        </div>
      </div>
      
      {/* Stats row */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        {duration && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>{duration}</span>
          </div>
        )}
        
        {objectsFetched && (
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span>PropertyCollector: {objectsFetched.toLocaleString()} objects</span>
            {fetchTime && <span className="text-muted-foreground/60">({formatDuration(fetchTime)})</span>}
          </div>
        )}
        
        {details.use_property_collector && !objectsFetched && (
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span>PropertyCollector mode</span>
          </div>
        )}
      </div>
    </div>
  );
};
