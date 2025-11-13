import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, CheckCircle, XCircle, PlayCircle, Server, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  component_order?: number | null;
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
  const [subJobs, setSubJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && job) {
      fetchTasks();
      
      // Fetch sub-jobs for full_server_update jobs
      if (job.job_type === 'full_server_update') {
        fetchSubJobs();
      }

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
      
      // Subscribe to sub-jobs updates if this is a full server update
      const jobsChannel = job.job_type === 'full_server_update' 
        ? supabase
            .channel(`sub-jobs-${job.id}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'jobs',
                filter: `parent_job_id=eq.${job.id}`
              },
              () => {
                console.log('Sub-jobs updated');
                fetchSubJobs();
              }
            )
            .subscribe()
        : null;

      return () => {
        supabase.removeChannel(channel);
        if (jobsChannel) {
          supabase.removeChannel(jobsChannel);
        }
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

  const fetchSubJobs = async () => {
    if (!job) return;

    try {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("parent_job_id", job.id)
        .order("component_order", { ascending: true });

      if (error) throw error;
      setSubJobs(data || []);
    } catch (error) {
      console.error("Error fetching sub-jobs:", error);
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
          {tasks.length > 0 && job.job_type !== 'discovery_scan' && (
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

          {/* Discovery Scan Results */}
          {job.job_type === 'discovery_scan' && job.status === 'completed' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Discovered</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-primary">
                      {job.details?.discovered_count || 0}
                    </p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Auth Failures</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-destructive">
                      {job.details?.auth_failures || 0}
                    </p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Scanned IPs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">
                      {job.details?.scanned_ips || 0}
                    </p>
                  </CardContent>
                </Card>
              </div>
              
              {job.details?.auth_failure_ips && job.details.auth_failure_ips.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Authentication Failures</AlertTitle>
                  <AlertDescription>
                    <p className="mb-2">These IPs responded but authentication failed with all credential sets:</p>
                    <ScrollArea className="h-32 w-full rounded border p-2 bg-background">
                      <ul className="list-disc list-inside space-y-1">
                        {job.details.auth_failure_ips.map((ip: string) => (
                          <li key={ip} className="text-sm">{ip}</li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Sub-Jobs List (for full_server_update) */}
          {job.job_type === 'full_server_update' && subJobs.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-4">Component Updates ({subJobs.length})</h3>
                <div className="space-y-2">
                  {subJobs.map((subJob) => (
                    <div key={subJob.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(subJob.status)}
                        <div>
                          <p className="font-medium text-sm">
                            {subJob.details?.component || 'Unknown Component'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Order: {subJob.component_order || 'N/A'}
                          </p>
                        </div>
                      </div>
                      {getStatusBadge(subJob.status)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tasks List */}
          {job.job_type !== 'full_server_update' && (
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
