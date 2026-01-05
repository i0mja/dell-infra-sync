import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

import { JobDetailDialog } from "@/components/jobs/JobDetailDialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Briefcase,
  CheckCircle,
  Clock,
  FileText,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  XCircle,
  Calendar,
  Filter,
  BarChart3,
  AlertCircle,
  Zap
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "react-router-dom";
import { ClusterUpdateWizard } from "./ClusterUpdateWizard";

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

const viewMetadata = {
  all: {
    title: "All Jobs",
    description: "View and manage all jobs across the system",
    icon: Briefcase,
  },
  active: {
    title: "Active Jobs",
    description: "Monitor running and pending jobs in real-time",
    icon: PlayCircle,
  },
  completed: {
    title: "Completed Jobs",
    description: "Review successfully finished jobs",
    icon: CheckCircle,
  },
  failed: {
    title: "Failed Jobs",
    description: "Investigate errors and retry failed jobs",
    icon: XCircle,
  },
  scheduled: {
    title: "Scheduled Jobs",
    description: "Manage jobs scheduled for future execution",
    icon: Calendar,
  },
};

type JobView = keyof typeof viewMetadata;

export const JobsPanel = ({ defaultView = "all" }: { defaultView?: JobView }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [updateWizardOpen, setUpdateWizardOpen] = useState(false);
  const [preSelectedClusterForUpdate, setPreSelectedClusterForUpdate] = useState<string | undefined>();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [subJobCounts, setSubJobCounts] = useState<Record<string, number>>({});
  const [staleThresholds, setStaleThresholds] = useState({ pending: 24, running: 48 });
  const [selectedJobType, setSelectedJobType] = useState<string>("all");
  const [view, setView] = useState<JobView>(defaultView);
  const { toast } = useToast();
  const { userRole } = useAuth();

  const currentView = viewMetadata[view] || viewMetadata.all;
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

  useEffect(() => {
    fetchJobs();
    fetchStaleThresholds();

    const channel = supabase
      .channel('jobs-panel-changes')
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

  const getFailureSummary = (job: Job) => {
    if (job.details?.validation_errors) {
      const errors = Array.isArray(job.details.validation_errors)
        ? job.details.validation_errors
        : typeof job.details.validation_errors === 'object'
          ? Object.entries(job.details.validation_errors).map(([key, value]) => `${key}: ${value}`)
          : [job.details.validation_errors];
      return `Validation failed: ${String(errors[0])}`;
    }

    if (job.details?.error) {
      return job.details.error;
    }

    return null;
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
      discovery_scan: "Initial Server Sync",
      vcenter_sync: "vCenter Sync",
      full_server_update: "Full Server Update",
      firmware_inventory_scan: "Check for Updates",
    };
    return labels[type] || type;
  };

  const filterJobs = (filterView: JobView) => {
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
      // First fetch the current job to preserve existing details
      const { data: currentJob } = await supabase
        .from('jobs')
        .select('details')
        .eq('id', jobId)
        .single();

      const { error } = await supabase.functions.invoke('update-job', {
        body: {
          job: {
            id: jobId,
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            details: {
              ...(typeof currentJob?.details === 'object' && currentJob?.details !== null ? currentJob.details : {}),
              cancelled_at: new Date().toISOString(),
              cancellation_reason: 'Cancelled by user'
            }
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

  // Handle cluster expansion request from wizard
  const handleClusterExpansionRequest = (clusterName: string) => {
    setUpdateWizardOpen(false);
    setPreSelectedClusterForUpdate(clusterName);
    
    // Re-open wizard after a short delay with cluster pre-selected
    setTimeout(() => {
      setUpdateWizardOpen(true);
    }, 100);
  };

  const handleViewDetails = (job: Job) => {
    setSelectedJob(job);
    setDetailDialogOpen(true);
  };

  const filteredJobs = useMemo(() => filterJobs(view), [jobs, view, selectedJobType]);

  const renderJobsList = () => {
    if (loading) {
      return (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    if (filteredJobs.length === 0) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <currentView.icon className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-semibold mb-2">No {currentView.title.toLowerCase()}</p>
            <p className="text-muted-foreground mb-6">
              {currentView.description}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setUpdateWizardOpen(true)}>
                <Zap className="mr-2 h-4 w-4" />
                Firmware Update
              </Button>
              <Button variant="outline" asChild>
                <Link to="/servers">
                  <Search className="mr-2 h-4 w-4" />
                  Initial Server Sync
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/settings?tab=jobs">
                  <Settings className="mr-2 h-4 w-4" />
                  Configure
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {filteredJobs.map((job) => {
          const failureSummary = getFailureSummary(job);

          return (
            <ContextMenu key={job.id}>
              <ContextMenuTrigger asChild>
                <Card
                  className="hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => handleViewDetails(job)}
                >
                  <CardContent className="p-6 space-y-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            {getStatusIcon(job.status)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-lg font-semibold flex items-center gap-2">
                                {getJobTypeLabel(job.job_type)}
                                {job.status === 'running' && (
                                  <Badge variant="secondary" className="animate-pulse bg-primary/10 text-primary border-primary/20">
                                    Live
                                  </Badge>
                                )}
                                {isJobStale(job) && (
                                  <Badge variant="destructive" className="flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3" />
                                    Stale
                                  </Badge>
                                )}
                              </h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Created {new Date(job.created_at).toLocaleString()} by {job.created_by || 'system'}
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
                    </div>

                    {failureSummary && job.status === 'failed' && (
                      <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 p-3 rounded-lg">
                        <AlertCircle className="h-4 w-4 mt-0.5" />
                        <div className="text-sm">
                          <span className="font-medium text-destructive">Error: </span>
                          <span className="font-mono text-destructive/80">
                            {failureSummary.length > 100
                              ? `${failureSummary.substring(0, 100)}...`
                              : failureSummary}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
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
                      <div>
                        <span className="text-muted-foreground">
                          {job.job_type === 'full_server_update' ? 'Components:' : 'Target:'}
                        </span>
                        <p className="font-medium">
                          {job.job_type === 'full_server_update'
                            ? `${subJobCounts[job.id] || 0} component updates`
                            : (job.target_scope?.cluster_name ||
                               (job.target_scope?.server_ids ? `${job.target_scope.server_ids.length} servers` : "N/A"))}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Scheduled:</span>
                        <p className="font-medium">
                          {job.schedule_at ? new Date(job.schedule_at).toLocaleString() : "Immediate"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </ContextMenuTrigger>

              <ContextMenuContent className="w-48">
                <ContextMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewDetails(job);
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  View Details
                </ContextMenuItem>

                {canManageJobs && (job.status === 'pending' || job.status === 'running') && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelJob(job.id);
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Cancel Job
                    </ContextMenuItem>
                  </>
                )}

                {canManageJobs && job.status === 'failed' && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetryJob(job);
                      }}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Retry Job
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    );
  };

  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running').length;
  const completedJobs = jobs.filter(j => j.status === 'completed').length;
  const failedJobs = jobs.filter(j => j.status === 'failed' || j.status === 'cancelled').length;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-primary/10">
            <currentView.icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">{currentView.title}</h2>
            <p className="text-muted-foreground">
              {currentView.description}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={fetchJobs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" asChild>
            <Link to="/settings?tab=jobs">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
          <Button variant="default" onClick={() => setUpdateWizardOpen(true)}>
            <Zap className="mr-2 h-4 w-4" />
            Firmware Update
          </Button>
          <Button variant="outline" asChild>
            <Link to="/servers">
              <Search className="mr-2 h-4 w-4" />
              Discovery Scan
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={view} onValueChange={(value) => setView(value as JobView)}>
        <div className="flex flex-col gap-4 mb-4">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="failed">Failed</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
          </TabsList>

          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
                <PlayCircle className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">{activeJobs}</div>
                    <p className="text-xs text-muted-foreground">Running or pending</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <CheckCircle className="h-4 w-4 text-success" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">{completedJobs}</div>
                    <p className="text-xs text-muted-foreground">Successfully finished</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Failed</CardTitle>
                <XCircle className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">{failedJobs}</div>
                    <p className="text-xs text-muted-foreground">Errors or cancelled</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filter by type:</span>
            </div>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedJobType('all')}
              >
                Clear filter
              </Button>
            )}
          </div>
        </div>

        <TabsContent value={view} className="space-y-4">
          {renderJobsList()}
        </TabsContent>
      </Tabs>

      <ClusterUpdateWizard
        open={updateWizardOpen}
        onOpenChange={(open) => {
          setUpdateWizardOpen(open);
          if (!open) setPreSelectedClusterForUpdate(undefined);
        }}
        preSelectedCluster={preSelectedClusterForUpdate}
        onClusterExpansionRequest={handleClusterExpansionRequest}
      />

      {selectedJob && (
        <JobDetailDialog
          job={selectedJob}
          open={detailDialogOpen}
          onOpenChange={setDetailDialogOpen}
        />
      )}
    </div>
  );
};

export default JobsPanel;
