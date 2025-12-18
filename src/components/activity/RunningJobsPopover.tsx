import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { XCircle, Eye, StopCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { getJobLabel, getTargetScopeLabel } from "@/lib/job-labels";
import { cn } from "@/lib/utils";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_at: string;
  started_at: string | null;
}

interface RunningJobsPopoverProps {
  jobs: Job[];
  onCancelJob: (jobId: string) => void;
  onViewJob: (jobId: string) => void;
  onViewAllRunning: () => void;
  onCancelAllRunning: () => void;
  canManage: boolean;
}

export function RunningJobsPopover({
  jobs,
  onCancelJob,
  onViewJob,
  onViewAllRunning,
  onCancelAllRunning,
  canManage,
}: RunningJobsPopoverProps) {
  const [open, setOpen] = useState(false);
  
  const runningJobs = jobs.filter(j => j.status === 'running');
  const pendingJobs = jobs.filter(j => j.status === 'pending');
  const totalActive = runningJobs.length + pendingJobs.length;

  if (totalActive === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20",
            "ring-1 ring-blue-500/30 cursor-pointer"
          )}
        >
          <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          {totalActive} {totalActive === 1 ? 'job' : 'jobs'} active
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <div className="flex items-center justify-between p-3 border-b">
          <h4 className="font-semibold text-sm">Active Jobs</h4>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onViewAllRunning}>
              <Eye className="h-3 w-3 mr-1" />
              View All
            </Button>
            {canManage && totalActive > 1 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={onCancelAllRunning}
              >
                <StopCircle className="h-3 w-3 mr-1" />
                Cancel All
              </Button>
            )}
          </div>
        </div>
        
        <ScrollArea className="max-h-[400px]">
          {/* Running Jobs */}
          {runningJobs.length > 0 && (
            <div className="p-2">
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Running ({runningJobs.length})
              </div>
              <div className="space-y-1">
                {runningJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onCancel={() => onCancelJob(job.id)}
                    onView={() => {
                      onViewJob(job.id);
                      setOpen(false);
                    }}
                    canManage={canManage}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Pending Jobs */}
          {pendingJobs.length > 0 && (
            <>
              {runningJobs.length > 0 && <Separator />}
              <div className="p-2">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Pending ({pendingJobs.length})
                </div>
                <div className="space-y-1">
                  {pendingJobs.map((job, index) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      queuePosition={index + 1}
                      onCancel={() => onCancelJob(job.id)}
                      onView={() => {
                        onViewJob(job.id);
                        setOpen(false);
                      }}
                      canManage={canManage}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

interface JobCardProps {
  job: Job;
  queuePosition?: number;
  onCancel: () => void;
  onView: () => void;
  canManage: boolean;
}

function JobCard({ job, queuePosition, onCancel, onView, canManage }: JobCardProps) {
  const { label, icon: Icon } = getJobLabel(job.job_type);
  const targetLabel = getTargetScopeLabel(job.target_scope);
  const isRunning = job.status === 'running';
  
  // Extract progress from details if available
  const progress = job.details?.progress ?? (isRunning ? undefined : 0);
  const timeAgo = job.started_at 
    ? formatDistanceToNow(new Date(job.started_at), { addSuffix: true })
    : formatDistanceToNow(new Date(job.created_at), { addSuffix: true });

  return (
    <div 
      className={cn(
        "p-2 rounded-md border bg-card hover:bg-muted/50 transition-colors cursor-pointer",
        isRunning && "border-blue-500/30 bg-blue-500/5"
      )}
      onClick={onView}
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          "p-1.5 rounded-md",
          isRunning ? "bg-blue-500/10 text-blue-600" : "bg-muted text-muted-foreground"
        )}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{label}</span>
            {queuePosition && (
              <span className="text-xs text-muted-foreground">#{queuePosition} in queue</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {targetLabel} • {isRunning ? 'Started' : 'Created'} {timeAgo}
          </div>
          {isRunning && progress !== undefined && (
            <div className="mt-1.5">
              <Progress value={progress} className="h-1" />
            </div>
          )}
        </div>
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          >
            <XCircle className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
