import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle, Clock, PlayCircle, XCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface JobTask {
  id: string;
  status: string;
  log: string | null;
  progress: number | null;
  started_at: string | null;
  completed_at: string | null;
  server_id: string | null;
  vcenter_host_id: string | null;
}

interface JobTasksTimelineProps {
  jobId: string;
}

export const JobTasksTimeline = ({ jobId }: JobTasksTimelineProps) => {
  const [tasks, setTasks] = useState<JobTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!jobId) return;

    const fetchTasks = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('job_tasks')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        setTasks(data);
      }
      setLoading(false);
    };

    fetchTasks();

    // Subscribe to real-time task updates
    const channel = supabase
      .channel(`job-tasks-timeline-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_tasks',
          filter: `job_id=eq.${jobId}`
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setTasks(prev => [...prev, payload.new as JobTask]);
          } else if (payload.eventType === 'UPDATE') {
            setTasks(prev => prev.map(t => 
              t.id === payload.new.id ? payload.new as JobTask : t
            ));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-success" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'running':
        return <PlayCircle className="h-5 w-5 text-primary animate-pulse" />;
      default:
        return <Circle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getDuration = (task: JobTask) => {
    if (!task.started_at) return null;
    
    const end = task.completed_at ? new Date(task.completed_at) : new Date();
    const start = new Date(task.started_at);
    const ms = end.getTime() - start.getTime();
    const seconds = Math.floor(ms / 1000);
    
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Task Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (tasks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Task Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No task details available for this job.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task Progress ({tasks.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {tasks.map((task, index) => (
            <div 
              key={task.id} 
              className={cn(
                "relative pl-8 pb-4",
                index !== tasks.length - 1 && "border-l-2 border-border ml-2"
              )}
            >
              {/* Status Icon */}
              <div className="absolute left-0 top-0 -ml-2.5">
                {getStatusIcon(task.status)}
              </div>

              {/* Task Content */}
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {task.log && (
                      <p className="text-sm font-medium break-words">{task.log}</p>
                    )}
                    {!task.log && (
                      <p className="text-sm text-muted-foreground">Task {index + 1}</p>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {getDuration(task) && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {getDuration(task)}
                      </span>
                    )}
                    <Badge 
                      variant={
                        task.status === 'completed' ? 'secondary' :
                        task.status === 'failed' ? 'destructive' :
                        task.status === 'running' ? 'default' : 'outline'
                      }
                      className="text-xs"
                    >
                      {task.status}
                    </Badge>
                  </div>
                </div>

                {/* Progress Bar */}
                {task.status === 'running' && task.progress !== null && (
                  <div className="space-y-1">
                    <Progress value={task.progress} className="h-1.5" />
                    <span className="text-xs text-muted-foreground">{task.progress}%</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
