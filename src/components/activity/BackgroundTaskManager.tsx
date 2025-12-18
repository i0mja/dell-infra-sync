import { useState, useEffect, useMemo } from "react";
import { formatDistanceToNow, differenceInSeconds, isPast } from "date-fns";
import { 
  Clock, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Timer,
  ChevronDown,
  ChevronUp,
  Settings,
  Server,
  Shield,
  Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SCHEDULED_BACKGROUND_JOB_TYPES } from "@/lib/job-constants";
import { cn } from "@/lib/utils";

interface BackgroundJob {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  schedule_at: string | null;
  details: any;
}

interface BackgroundTaskConfig {
  type: string;
  label: string;
  icon: React.ElementType;
  description: string;
  settingsPath?: string;
}

const BACKGROUND_TASK_REGISTRY: BackgroundTaskConfig[] = [
  {
    type: 'scheduled_vcenter_sync',
    label: 'vCenter Sync',
    icon: Server,
    description: 'Synchronizes VM and host data from vCenter',
    settingsPath: '/settings/vcenter',
  },
  {
    type: 'scheduled_replication_check',
    label: 'Replication Check',
    icon: Shield,
    description: 'Verifies replication status for protection groups',
    settingsPath: '/disaster-recovery',
  },
  {
    type: 'rpo_monitoring',
    label: 'RPO Monitoring',
    icon: Activity,
    description: 'Monitors Recovery Point Objectives',
    settingsPath: '/disaster-recovery',
  },
];

export function BackgroundTaskManager() {
  const { session } = useAuth();
  const [isOpen, setIsOpen] = useState(true);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBackgroundJobs = async () => {
    try {
      // Fetch recent jobs for each background task type
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

    // Subscribe to job changes
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

  // Group jobs by type and get the latest status for each
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

  // Count active background tasks
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
    <Card className="border-dashed">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="py-3 px-4">
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Background Tasks</CardTitle>
                {activeCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {activeCount} active
                  </Badge>
                )}
              </div>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </CollapsibleTrigger>
        </CardHeader>
        
        <CollapsibleContent>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="space-y-2">
              {BACKGROUND_TASK_REGISTRY.map((task) => {
                const { state, job } = getTaskStatus(task.type);
                const Icon = task.icon;
                const countdown = job && state === 'scheduled' ? getScheduleCountdown(job) : null;
                const lastRun = taskStatuses.get(task.type)?.lastCompleted;
                
                return (
                  <div 
                    key={task.type}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-md border bg-card/50",
                      state === 'running' && "border-blue-500/30 bg-blue-500/5",
                      state === 'scheduled' && "border-muted"
                    )}
                  >
                    <div className={cn(
                      "p-1.5 rounded-md",
                      state === 'running' ? "bg-blue-500/10 text-blue-600" : 
                      state === 'scheduled' ? "bg-amber-500/10 text-amber-600" :
                      "bg-muted text-muted-foreground"
                    )}>
                      <Icon className="h-4 w-4" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{task.label}</span>
                        {state === 'running' && (
                          <Badge variant="outline" className="text-xs border-blue-500 text-blue-500 bg-blue-500/10">
                            <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                            Running
                          </Badge>
                        )}
                        {state === 'scheduled' && countdown && (
                          <Badge variant="outline" className="text-xs border-amber-500 text-amber-500 bg-amber-500/10">
                            <Timer className="h-3 w-3 mr-1" />
                            In {countdown}
                          </Badge>
                        )}
                        {state === 'idle' && lastRun && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {formatDistanceToNow(new Date(lastRun.completed_at!), { addSuffix: true })}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {task.description}
                      </p>
                    </div>
                    
                    {task.settingsPath && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground shrink-0"
                        asChild
                      >
                        <a href={task.settingsPath}>
                          <Settings className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                );
              })}
              
              {BACKGROUND_TASK_REGISTRY.length === 0 && (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  No background tasks configured
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}