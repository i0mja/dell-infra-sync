import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Clock, CheckCircle2, XCircle, Loader2, Server, Network, Settings } from "lucide-react";
import { useJobProgress } from "@/hooks/useJobProgress";
import { ApiCallStream } from "@/components/jobs/ApiCallStream";
import { cn } from "@/lib/utils";

interface JobActivityCardProps {
  job: {
    id: string;
    job_type: string;
    status: string;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    details: any;
    target_scope: any;
  };
}

export function JobActivityCard({ job }: JobActivityCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: progress } = useJobProgress(job.id, true);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      running: "bg-blue-500/10 text-blue-500 border-blue-500/20",
      completed: "bg-green-500/10 text-green-500 border-green-500/20",
      failed: "bg-red-500/10 text-red-500 border-red-500/20",
    };

    return (
      <Badge variant="outline" className={variants[status] || ""}>
        {status}
      </Badge>
    );
  };

  const getJobTypeIcon = (type: string) => {
    if (type.includes('discovery')) return <Network className="h-4 w-4" />;
    if (type.includes('firmware') || type.includes('update')) return <Settings className="h-4 w-4" />;
    return <Server className="h-4 w-4" />;
  };

  const formatJobType = (type: string) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getElapsedTime = () => {
    const start = job.started_at || job.created_at;
    const end = job.completed_at || new Date().toISOString();
    const elapsed = new Date(end).getTime() - new Date(start).getTime();
    
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getTargetScope = () => {
    const scope = job.target_scope;
    if (!scope) return null;
    
    if (scope.server_ids?.length) {
      return `${scope.server_ids.length} server${scope.server_ids.length > 1 ? 's' : ''}`;
    }
    if (scope.ip_ranges?.length) {
      const totalIPs = scope.ip_ranges.reduce((sum: number, range: any) => {
        return sum + (range.ip_list?.length || 0);
      }, 0);
      return `${totalIPs} IP${totalIPs !== 1 ? 's' : ''}`;
    }
    return null;
  };

  const getStageInfo = () => {
    const details = job.details;
    if (!details) return null;

    // Initial server sync stage info
    if (job.job_type === 'discovery_scan' && details.stage) {
      const stageLabels: Record<string, string> = {
        port_scan: 'Stage 1: Port Scan',
        idrac_detection: 'Stage 2: iDRAC Detection',
        full_discovery: 'Stage 3: Full Discovery',
      };
      
      const stageLabel = stageLabels[details.stage] || details.stage;
      const stageProgress = details.stage_progress;
      
      if (stageProgress) {
        return `${stageLabel} (${stageProgress.current}/${stageProgress.total})`;
      }
      return stageLabel;
    }

    return null;
  };

  const progressPercent = progress?.progressPercent || 0;
  const targetScope = getTargetScope();
  const stageInfo = getStageInfo();

  return (
    <Card className={cn(
      "transition-all duration-200",
      job.status === 'running' && "border-blue-500/30 shadow-sm"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 flex-1">
            <div className="flex items-center gap-2">
              {getJobTypeIcon(job.job_type)}
              {getStatusIcon(job.status)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-base">
                  {formatJobType(job.job_type)}
                </h3>
                {getStatusBadge(job.status)}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {getElapsedTime()}
                </span>
                {targetScope && (
                  <span className="flex items-center gap-1">
                    <Server className="h-3 w-3" />
                    {targetScope}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="shrink-0"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Progress Bar */}
        {(job.status === 'running' || job.status === 'pending') && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {stageInfo || `${progress?.completedTasks || 0} / ${progress?.totalTasks || 0} tasks`}
              </span>
              <span className="font-medium">{Math.round(progressPercent)}%</span>
            </div>
            <Progress value={progressPercent} className="h-1.5" />
          </div>
        )}

        {/* Current Log */}
        {progress?.currentStep && job.status === 'running' && (
          <div className="rounded-md bg-muted/50 p-2 text-xs font-mono text-muted-foreground">
            {progress.currentStep}
          </div>
        )}

        {/* Expandable API Stream */}
        {isExpanded && (
          <div className="border-t pt-3 mt-3">
            <div className="text-xs font-semibold mb-2 text-muted-foreground">
              Live Activity Stream
            </div>
            <ApiCallStream jobId={job.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
