import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, CheckCircle, XCircle, PlayCircle, Server } from "lucide-react";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface JobTask {
  id: string;
  server_id: string | null;
  status: string;
  log: string | null;
  started_at: string | null;
  completed_at: string | null;
  servers?: {
    ip_address: string;
    hostname: string | null;
  };
}

interface JobDetailDialogProps {
  job: Job;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const JobDetailDialog = ({ job, open, onOpenChange }: JobDetailDialogProps) => {
  const [tasks, setTasks] = useState<JobTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && job) {
      fetchTasks();

      // Set up realtime subscription for tasks
      const channel = supabase
        .channel(`job-tasks-${job.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'job_tasks',
            filter: `job_id=eq.${job.id}`
          },
          () => {
            console.log('Tasks updated');
            fetchTasks();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [open, job]);

  const fetchTasks = async () => {
    if (!job) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("job_tasks")
        .select(`
          *,
          servers (ip_address, hostname)
        `)
        .eq("job_id", job.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setTasks(data || []);
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'running':
        return <PlayCircle className="h-4 w-4 text-primary animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "secondary",
      failed: "destructive",
      running: "default",
      pending: "outline",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const failedTasks = tasks.filter(t => t.status === 'failed').length;
  const progress = tasks.length > 0 ? ((completedTasks + failedTasks) / tasks.length) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Job Details</DialogTitle>
            {getStatusBadge(job.status)}
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Job Info */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Type:</span>
                  <p className="font-medium capitalize">{job.job_type.replace('_', ' ')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>
                  <p className="font-medium">{new Date(job.created_at).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Started:</span>
                  <p className="font-medium">
                    {job.started_at ? new Date(job.started_at).toLocaleString() : "Not started"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Completed:</span>
                  <p className="font-medium">
                    {job.completed_at ? new Date(job.completed_at).toLocaleString() : "-"}
                  </p>
                </div>
              </div>
              {job.details?.notes && (
                <div className="mt-4 pt-4 border-t">
                  <span className="text-sm text-muted-foreground">Notes:</span>
                  <p className="text-sm mt-1">{job.details.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Progress */}
          {tasks.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span className="font-medium">{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{completedTasks} completed</span>
                    {failedTasks > 0 && <span className="text-destructive">{failedTasks} failed</span>}
                    <span>{tasks.length - completedTasks - failedTasks} remaining</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tasks List */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Server className="h-4 w-4" />
                Tasks ({tasks.length})
              </h3>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No tasks found for this job
                </p>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div key={task.id} className="border rounded-lg p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(task.status)}
                            <div>
                              <p className="font-medium text-sm">
                                {task.servers?.hostname || task.servers?.ip_address || "Unknown server"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {task.started_at
                                  ? `Started ${new Date(task.started_at).toLocaleString()}`
                                  : "Waiting to start"}
                              </p>
                            </div>
                          </div>
                          {getStatusBadge(task.status)}
                        </div>
                        {task.log && (
                          <div className="mt-2 text-xs bg-muted p-2 rounded font-mono whitespace-pre-wrap">
                            {task.log}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
};
