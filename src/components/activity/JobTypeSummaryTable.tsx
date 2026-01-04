import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Activity, 
  History, 
  Play, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Timer,
  Loader2,
  MoreHorizontal,
  Settings,
  StopCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import { JobTypeSummary } from "@/hooks/useJobTypeSummaries";
import { Job } from "@/components/activity/JobsTable";
import { SCHEDULED_JOB_REGISTRY, ScheduledJobConfig } from "@/lib/scheduled-jobs";
import { useNavigate } from "react-router-dom";

interface JobTypeSummaryTableProps {
  summaries: JobTypeSummary[];
  onViewHistory: (jobType: string, label: string) => void;
  onViewLatest: (job: Job) => void;
  onCancelJob?: (jobId: string) => void;
  canManage?: boolean;
}

export function JobTypeSummaryTable({
  summaries,
  onViewHistory,
  onViewLatest,
  onCancelJob,
  canManage = false,
}: JobTypeSummaryTableProps) {
  const navigate = useNavigate();

  const getStatusIndicator = (summary: JobTypeSummary) => {
    const { stats, currentJob } = summary;
    
    if (stats.runningCount > 0) {
      return (
        <Badge variant="default" className="bg-primary text-primary-foreground text-xs gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running ({stats.runningCount})
        </Badge>
      );
    }
    
    if (stats.pendingCount > 0) {
      return (
        <Badge variant="secondary" className="text-xs gap-1">
          <Clock className="h-3 w-3" />
          Pending ({stats.pendingCount})
        </Badge>
      );
    }
    
    // Show last run status
    if (summary.lastFailed && summary.lastCompleted) {
      const failedTime = new Date(summary.lastFailed.created_at).getTime();
      const completedTime = new Date(summary.lastCompleted.created_at).getTime();
      
      if (failedTime > completedTime) {
        return (
          <Badge variant="destructive" className="text-xs gap-1">
            <XCircle className="h-3 w-3" />
            Last Failed
          </Badge>
        );
      }
    }
    
    if (summary.lastCompleted) {
      return (
        <Badge variant="default" className="bg-success text-success-foreground text-xs gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Healthy
        </Badge>
      );
    }
    
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        No runs
      </Badge>
    );
  };

  const getSuccessRate = (stats: JobTypeSummary['stats']) => {
    const completed = stats.successCount + stats.failureCount;
    if (completed === 0) return null;
    
    const rate = (stats.successCount / completed) * 100;
    return {
      rate,
      label: `${Math.round(rate)}%`,
      detail: `${stats.successCount}/${completed}`,
    };
  };

  const formatDuration = (ms: number) => {
    if (ms === 0) return '—';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getLastRunTime = (summary: JobTypeSummary) => {
    const job = summary.currentJob || summary.lastCompleted || summary.lastFailed;
    if (!job) return '—';
    
    return formatDistanceToNow(new Date(job.created_at), { addSuffix: true });
  };

  const getScheduledJobConfig = (jobType: string): ScheduledJobConfig | undefined => {
    return SCHEDULED_JOB_REGISTRY[jobType];
  };

  const handleConfigure = (jobType: string) => {
    const config = getScheduledJobConfig(jobType);
    if (config?.schedule?.settingsPath) {
      navigate(config.schedule.settingsPath);
    }
  };

  if (summaries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Activity className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground">No jobs found</h3>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Jobs will appear here once they are created
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-auto h-full">
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead className="w-[280px]">Job Type</TableHead>
            <TableHead className="w-[140px]">Status</TableHead>
            <TableHead className="w-[130px]">Last Run</TableHead>
            <TableHead className="w-[150px]">Success Rate</TableHead>
            <TableHead className="w-[80px] text-center">Runs</TableHead>
            <TableHead className="w-[100px]">Avg Duration</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaries.map((summary) => {
            const successRate = getSuccessRate(summary.stats);
            const config = getScheduledJobConfig(summary.jobType);
            
            return (
              <TableRow 
                key={summary.jobType}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onViewHistory(summary.jobType, summary.label)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="font-medium text-sm">{summary.label}</span>
                      {config?.schedule && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <Clock className="h-3 w-3" />
                          {config.schedule.interval}
                        </div>
                      )}
                    </div>
                  </div>
                </TableCell>
                
                <TableCell>
                  {getStatusIndicator(summary)}
                </TableCell>
                
                <TableCell className="text-sm text-muted-foreground">
                  {getLastRunTime(summary)}
                </TableCell>
                
                <TableCell>
                  {successRate ? (
                    <div className="flex items-center gap-2">
                      <Progress 
                        value={successRate.rate} 
                        className="h-2 w-16"
                      />
                      <span className="text-sm font-medium">
                        {successRate.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({successRate.detail})
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                
                <TableCell className="text-center">
                  <Badge variant="outline" className="text-xs font-mono">
                    {summary.stats.totalRuns}
                  </Badge>
                </TableCell>
                
                <TableCell className="text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Timer className="h-3 w-3" />
                    {formatDuration(summary.stats.avgDurationMs)}
                  </div>
                </TableCell>
                
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewHistory(summary.jobType, summary.label);
                      }}
                    >
                      <History className="h-4 w-4" />
                    </Button>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onViewHistory(summary.jobType, summary.label)}>
                          <History className="mr-2 h-4 w-4" />
                          View History
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onViewLatest(summary.latestJob)}>
                          <Play className="mr-2 h-4 w-4" />
                          View Latest Run
                        </DropdownMenuItem>
                        {summary.stats.failureCount > 0 && summary.lastFailed && (
                          <DropdownMenuItem onClick={() => onViewLatest(summary.lastFailed!)}>
                            <XCircle className="mr-2 h-4 w-4" />
                            View Last Failure
                          </DropdownMenuItem>
                        )}
                        {config?.schedule?.configurable && canManage && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleConfigure(summary.jobType)}>
                              <Settings className="mr-2 h-4 w-4" />
                              Configure Schedule
                            </DropdownMenuItem>
                          </>
                        )}
                        {summary.currentJob && summary.stats.runningCount > 0 && canManage && onCancelJob && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={(e) => {
                                e.stopPropagation();
                                onCancelJob(summary.currentJob!.id);
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <StopCircle className="mr-2 h-4 w-4" />
                              Cancel Running Job
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
