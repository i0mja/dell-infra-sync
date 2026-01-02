import { useState, useEffect, useMemo } from "react";
import { formatDistanceToNow, differenceInSeconds, isPast } from "date-fns";
import { 
  Clock, 
  RefreshCw, 
  CheckCircle2, 
  Timer,
  Settings,
  Server,
  Shield,
  Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SCHEDULED_BACKGROUND_JOB_TYPES } from "@/lib/job-constants";
import { cn } from "@/lib/utils";
import { JobDetailDialog } from "@/components/jobs/JobDetailDialog";

interface BackgroundJob {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  schedule_at: string | null;
  details: any;
  target_scope?: any;
}

interface BackgroundTaskConfig {
  type: string;
  label: string;
  icon: React.ElementType;
  description: string;
}

const BACKGROUND_TASK_REGISTRY: BackgroundTaskConfig[] = [
  {
    type: 'scheduled_replication_check',
    label: 'Replication Check',
    icon: Shield,
    description: 'Verifies replication status for protection groups',
  },
  {
    type: 'rpo_monitoring',
    label: 'RPO Monitoring',
    icon: Activity,
    description: 'Monitors Recovery Point Objectives',
  },
];

export function BackgroundTaskManager() {
  const { session } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<BackgroundJob | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const getMostRecentJob = (taskType: string): BackgroundJob | null => {
    const status = taskStatuses.get(taskType);
    if (!status) return null;
    return status.running || status.pending || status.lastCompleted || status.lastFailed;
  };

  const fetchBackgroundJobs = async () => {
    try {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .in("job_type", [...SCHEDULED_BACKGROUND_JOB_TYPES])
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setJobs(data || []);
    } catch (error) {
      console.error("Error fetching background jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!session) return;

    fetchBackgroundJobs();

    const channel = supabase
      .channel(`background-jobs-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs'
        },
        () => {
          fetchBackgroundJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  const taskStatuses = useMemo(() => {
    const statusMap = new Map<string, {
      running: BackgroundJob | null;
      lastCompleted: BackgroundJob | null;
      pending: BackgroundJob | null;
      lastFailed: BackgroundJob | null;
    }>();

    BACKGROUND_TASK_REGISTRY.forEach(task => {
      const taskJobs = jobs.filter(j => j.job_type === task.type);
      
      statusMap.set(task.type, {
        running: taskJobs.find(j => j.status === 'running') || null,
        pending: taskJobs.find(j => j.status === 'pending') || null,
        lastCompleted: taskJobs.find(j => j.status === 'completed') || null,
        lastFailed: taskJobs.find(j => j.status === 'failed') || null,
      });
    });

    return statusMap;
  }, [jobs]);

  const activeCount = useMemo(() => {
    let count = 0;
    taskStatuses.forEach(status => {
      if (status.running || status.pending) count++;
    });
    return count;
  }, [taskStatuses]);

  const getTaskStatus = (taskType: string) => {
    const status = taskStatuses.get(taskType);
    if (!status) return { state: 'idle' as const, job: null };
    
    if (status.running) return { state: 'running' as const, job: status.running };
    if (status.pending) return { state: 'scheduled' as const, job: status.pending };
    if (status.lastCompleted) return { state: 'idle' as const, job: status.lastCompleted };
    return { state: 'idle' as const, job: null };
  };

  const getScheduleCountdown = (job: BackgroundJob): string | null => {
    if (!job.schedule_at) return null;
    const scheduleDate = new Date(job.schedule_at);
    if (isPast(scheduleDate)) return null;
    const seconds = differenceInSeconds(scheduleDate, new Date());
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 text-xs font-medium"
        >
          <Clock className="h-3.5 w-3.5" />
          Background Tasks
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 border-b">
          <h4 className="font-medium text-sm">Background Tasks</h4>
          <p className="text-xs text-muted-foreground">Scheduled and running background jobs</p>
        </div>
        
        <ScrollArea className="max-h-[300px]">
          <div className="p-2 space-y-1">
            {BACKGROUND_TASK_REGISTRY.map((task) => {
              const { state, job } = getTaskStatus(task.type);
              const Icon = task.icon;
              const countdown = job && state === 'scheduled' ? getScheduleCountdown(job) : null;
              const lastRun = taskStatuses.get(task.type)?.lastCompleted;
              
              return (
                <div 
                  key={task.type}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-md",
                    state === 'running' && "bg-blue-500/10",
                    state === 'scheduled' && "bg-amber-500/5",
                    state === 'idle' && "hover:bg-muted/50"
                  )}
                >
                  <div className={cn(
                    "p-1.5 rounded-md shrink-0",
                    state === 'running' ? "bg-blue-500/10 text-blue-600" : 
                    state === 'scheduled' ? "bg-amber-500/10 text-amber-600" :
                    "bg-muted text-muted-foreground"
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-xs">{task.label}</span>
                      {state === 'running' && (
                        <RefreshCw className="h-3 w-3 text-blue-500 animate-spin" />
                      )}
                      {state === 'scheduled' && countdown && (
                        <span className="text-xs text-amber-600">
                          <Timer className="h-3 w-3 inline mr-0.5" />
                          {countdown}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {state === 'idle' && lastRun ? (
                        <>
                          <CheckCircle2 className="h-2.5 w-2.5 inline mr-0.5" />
                          {formatDistanceToNow(new Date(lastRun.completed_at!), { addSuffix: true })}
                        </>
                      ) : (
                        task.description
                      )}
                    </p>
                  </div>
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground shrink-0"
                    onClick={() => {
                      const job = getMostRecentJob(task.type);
                      if (job) {
                        setSelectedJob(job);
                        setDialogOpen(true);
                      }
                    }}
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
            
            {BACKGROUND_TASK_REGISTRY.length === 0 && (
              <div className="text-center py-4 text-xs text-muted-foreground">
                No background tasks configured
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
      
      <JobDetailDialog
        job={selectedJob ? { ...selectedJob, target_scope: selectedJob.target_scope || null } : null}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </Popover>
  );
}
