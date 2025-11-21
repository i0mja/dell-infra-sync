import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { useAuth } from "@/hooks/useAuth";
import {
  CheckCircle,
  Clock,
  FileText,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  XCircle,
  Filter,
  BarChart3,
  AlertCircle
} from "lucide-react";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  schedule_at: string | null;
  parent_job_id: string | null;
}

interface JobsManagementCardProps {
  onJobClick?: (job: Job) => void;
  onCreateJob?: () => void;
}

export function JobsManagementCard({ onJobClick, onCreateJob }: JobsManagementCardProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'all' | 'active' | 'completed' | 'failed' | 'scheduled'>('active');
  const [selectedJobType, setSelectedJobType] = useState('all');
  const [staleThresholds, setStaleThresholds] = useState({ pending: 24, running: 48 });
  const [subJobCounts, setSubJobCounts] = useState<Record<string, number>>({});
  const { toast } = useToast();
  const { userRole } = useAuth();

  const canManageJobs = userRole === 'admin' || userRole === 'operator';

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .is("parent_job_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setJobs(data || []);

      // Fetch sub-job counts for full_server_update jobs
      const fullUpdateJobs = (data || []).filter(j => j.job_type === 'full_server_update');
      if (fullUpdateJobs.length > 0) {
        const counts: Record<string, number> = {};
        for (const job of fullUpdateJobs) {
          const { count } = await supabase
            .from("jobs")
            .select("*", { count: 'exact', head: true })
            .eq("parent_job_id", job.id);
          counts[job.id] = count || 0;
        }
        setSubJobCounts(counts);
      }
    } catch (error: any) {
      toast({
        title: "Error loading jobs",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchStaleThresholds = async () => {
    try {
      const { data } = await supabase
        .from('activity_settings')
        .select('stale_pending_hours, stale_running_hours')
        .limit(1)
        .maybeSingle();

      if (data) {
        setStaleThresholds({
          pending: data.stale_pending_hours || 24,
          running: data.stale_running_hours || 48
        });
      }
    } catch (error) {
      console.error('Error fetching stale thresholds:', error);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchStaleThresholds();

    const channel = supabase
      .channel('jobs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs'
        },
        () => {
          fetchJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const isJobStale = (job: Job): boolean => {
    if (job.status === 'pending') {
      const hoursOld = (new Date().getTime() - new Date(job.created_at).getTime()) / (1000 * 60 * 60);
      return hoursOld > staleThresholds.pending;
    }
    if (job.status === 'running' && job.started_at) {
      const hoursOld = (new Date().getTime() - new Date(job.started_at).getTime()) / (1000 * 60 * 60);
      return hoursOld > staleThresholds.running;
    }
    return false;
  };

  const getJobAge = (job: Job): string => {
    const referenceDate = job.status === 'running' && job.started_at
      ? new Date(job.started_at)
      : new Date(job.created_at);

    const hoursOld = (new Date().getTime() - referenceDate.getTime()) / (1000 * 60 * 60);
    const daysOld = Math.floor(hoursOld / 24);

    if (daysOld > 0) {
      return `${daysOld} day${daysOld !== 1 ? 's' : ''}`;
    }
    return `${Math.floor(hoursOld)} hour${Math.floor(hoursOld) !== 1 ? 's' : ''}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'running':
        return <PlayCircle className="h-4 w-4 text-primary animate-pulse" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-warning" />;
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
      cancelled: "outline",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  const getJobTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      firmware_update: "Firmware Update",
      discovery_scan: "Discovery Scan",
      vcenter_sync: "vCenter Sync",
      full_server_update: "Full Server Update",
      cluster_safety_check: "Safety Check",
    };
    return labels[type] || type;
  };

  const filterJobs = (filterView: string) => {
    let filtered = jobs;

    if (filterView === 'active') {
      filtered = filtered.filter(j => j.status === 'pending' || j.status === 'running');
    } else if (filterView === 'completed') {
      filtered = filtered.filter(j => j.status === 'completed');
    } else if (filterView === 'failed') {
      filtered = filtered.filter(j => j.status === 'failed' || j.status === 'cancelled');
    } else if (filterView === 'scheduled') {
      filtered = filtered.filter(j => j.schedule_at !== null && j.status === 'pending');
    }

    if (selectedJobType !== 'all') {
      filtered = filtered.filter(j => j.job_type === selectedJobType);
    }

    return filtered;
  };

  const handleCancelJob = async (jobId: string) => {
    if (!canManageJobs) {
      toast({
        title: "Permission denied",
        description: "You don't have permission to cancel jobs",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.functions.invoke('update-job', {
        body: {
          job: {
            id: jobId,
            status: 'cancelled',
            completed_at: new Date().toISOString(),
          }
        }
      });

      if (error) throw error;

      toast({
        title: "Job cancelled",
        description: "The job has been cancelled successfully",
      });
      fetchJobs();
    } catch (error: any) {
      toast({
        title: "Error cancelling job",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleRetryJob = async (job: Job) => {
    if (!canManageJobs) {
      toast({
        title: "Permission denied",
        description: "You don't have permission to retry jobs",
        variant: "destructive",
      });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { data: result, error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: job.job_type as "firmware_update" | "discovery_scan" | "vcenter_sync" | "full_server_update",
          created_by: user?.id,
          target_scope: job.target_scope,
          details: job.details
        }
      });

      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || 'Failed to create job');

      toast({
        title: "Job retried",
        description: "A new job has been created with the same configuration",
      });
      fetchJobs();
    } catch (error: any) {
      toast({
        title: "Error retrying job",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleViewDetails = (job: Job) => {
    onJobClick?.(job);
  };

  const filteredJobs = useMemo(() => filterJobs(view), [jobs, view, selectedJobType]);

  // Calculate stats
  const activeJobs = jobs.filter(j => ['pending', 'running'].includes(j.status)).length;
  const completedJobs = jobs.filter(j => j.status === 'completed').length;
  const failedJobs = jobs.filter(j => ['failed', 'cancelled'].includes(j.status)).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Jobs & Operations</CardTitle>
            <CardDescription>
              Monitor and manage all server management jobs
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchJobs}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={onCreateJob}>
              <Plus className="mr-2 h-4 w-4" />
              Create Job
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={view} onValueChange={(v) => setView(v as any)}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">
              Active {activeJobs > 0 && <Badge variant="secondary" className="ml-1">{activeJobs}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="failed">
              Failed {failedJobs > 0 && <Badge variant="destructive" className="ml-1">{failedJobs}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
          </TabsList>

          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <PlayCircle className="h-4 w-4" />
                Active
              </div>
              <div className="text-2xl font-bold">{activeJobs}</div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <CheckCircle className="h-4 w-4" />
                Completed
              </div>
              <div className="text-2xl font-bold">{completedJobs}</div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <XCircle className="h-4 w-4" />
                Failed
              </div>
              <div className="text-2xl font-bold">{failedJobs}</div>
            </div>
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedJobType} onValueChange={setSelectedJobType}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All job types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="firmware_update">Firmware Update</SelectItem>
                <SelectItem value="discovery_scan">Discovery Scan</SelectItem>
                <SelectItem value="vcenter_sync">vCenter Sync</SelectItem>
                <SelectItem value="full_server_update">Full Server Update</SelectItem>
              </SelectContent>
            </Select>
            {selectedJobType !== 'all' && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedJobType('all')}>
                Clear
              </Button>
            )}
          </div>

          {/* Job list */}
          <TabsContent value={view} className="mt-4 space-y-3">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="font-medium">No {view} jobs</p>
                <Button className="mt-4" onClick={onCreateJob}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Job
                </Button>
              </div>
            ) : (
              filteredJobs.map(job => (
                <ContextMenu key={job.id}>
                  <ContextMenuTrigger asChild>
                    <Card
                      className="hover:border-primary/50 transition-colors cursor-pointer"
                      onClick={() => handleViewDetails(job)}
                    >
                      <CardContent className="p-4 space-y-3">
                        {/* Job header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(job.status)}
                            <div>
                              <h4 className="font-semibold flex items-center gap-2">
                                {getJobTypeLabel(job.job_type)}
                                {job.status === 'running' && (
                                  <Badge variant="secondary" className="animate-pulse">
                                    Live
                                  </Badge>
                                )}
                                {isJobStale(job) && (
                                  <Badge variant="destructive">
                                    <AlertCircle className="h-3 w-3 mr-1" />
                                    Stale
                                  </Badge>
                                )}
                              </h4>
                              <p className="text-xs text-muted-foreground">
                                {new Date(job.created_at).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {getStatusBadge(job.status)}
                            <Badge variant="outline">
                              <BarChart3 className="h-3 w-3 mr-1" />
                              {getJobAge(job)}
                            </Badge>
                          </div>
                        </div>

                        {/* Error message */}
                        {job.details?.error && job.status === 'failed' && (
                          <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription className="text-xs">
                              {job.details.error.substring(0, 100)}...
                            </AlertDescription>
                          </Alert>
                        )}

                        {/* Job details grid */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Started:</span>
                            <p className="font-medium">
                              {job.started_at ? new Date(job.started_at).toLocaleString() : 'Pending'}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Target:</span>
                            <p className="font-medium">
                              {job.job_type === 'full_server_update'
                                ? `${subJobCounts[job.id] || 0} components`
                                : job.target_scope?.server_ids
                                  ? `${job.target_scope.server_ids.length} servers`
                                  : job.target_scope?.cluster_name || 'N/A'}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </ContextMenuTrigger>

                  {/* Context menu */}
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => handleViewDetails(job)}>
                      <FileText className="mr-2 h-4 w-4" />
                      View Details
                    </ContextMenuItem>

                    {canManageJobs && ['pending', 'running'].includes(job.status) && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => handleCancelJob(job.id)}
                          className="text-destructive"
                        >
                          <XCircle className="mr-2 h-4 w-4" />
                          Cancel Job
                        </ContextMenuItem>
                      </>
                    )}

                    {canManageJobs && job.status === 'failed' && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => handleRetryJob(job)}>
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Retry Job
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
