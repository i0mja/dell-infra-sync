import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useJobExecutor } from "@/contexts/JobExecutorContext";

export function ExecutorStatusIndicator() {
  const { status, heartbeat, isLoading } = useJobExecutor();

  const getStatusConfig = () => {
    switch (status) {
      case 'online':
        return {
          icon: CheckCircle2,
          label: 'Connected',
          className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
          dotClass: 'bg-emerald-500 animate-pulse'
        };
      case 'idle':
        return {
          icon: Activity,
          label: 'Idle',
          className: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
          dotClass: 'bg-amber-500'
        };
      case 'offline':
        return {
          icon: XCircle,
          label: 'Offline',
          className: 'bg-destructive/10 text-destructive border-destructive/20',
          dotClass: 'bg-destructive'
        };
      default:
        return {
          icon: AlertTriangle,
          label: 'Unknown',
          className: 'bg-muted text-muted-foreground border-border',
          dotClass: 'bg-muted-foreground'
        };
    }
  };

  if (isLoading) {
    return (
      <Badge variant="outline" className="gap-1.5 px-2 py-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Checking...</span>
      </Badge>
    );
  }

  const config = getStatusConfig();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`gap-1.5 px-2 py-1 cursor-help ${config.className}`}
          >
            <span className={`h-2 w-2 rounded-full ${config.dotClass}`} />
            <span className="text-xs font-medium">Job Executor: {config.label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1.5 text-xs">
            {heartbeat ? (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Last seen:</span>
                  <span className="font-medium">
                    {formatDistanceToNow(new Date(heartbeat.last_seen_at), { addSuffix: true })}
                  </span>
                </div>
                {heartbeat.hostname && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Host:</span>
                    <span className="font-medium">{heartbeat.hostname}</span>
                  </div>
                )}
                {heartbeat.ip_address && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">IP:</span>
                    <span className="font-medium font-mono">{heartbeat.ip_address}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Jobs processed:</span>
                  <span className="font-medium">{heartbeat.jobs_processed}</span>
                </div>
                {heartbeat.startup_time && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Uptime:</span>
                    <span className="font-medium">
                      {formatDistanceToNow(new Date(heartbeat.startup_time))}
                    </span>
                  </div>
                )}
                {heartbeat.last_error && (
                  <div className="pt-1 border-t border-border">
                    <span className="text-destructive">Last error: {heartbeat.last_error}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">
                No job executor has connected yet. Start the executor on your local network to process jobs.
              </p>
            )}
            {status === 'offline' && heartbeat && (
              <p className="pt-1 border-t border-border text-destructive">
                Executor appears offline. Check if job-executor.py is running.
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
