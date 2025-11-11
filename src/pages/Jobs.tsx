import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Briefcase, Plus, RefreshCw, Clock, CheckCircle, XCircle, PlayCircle, RotateCcw, FileText, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CreateJobDialog } from "@/components/jobs/CreateJobDialog";
import { JobDetailDialog } from "@/components/jobs/JobDetailDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";

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

const Jobs = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
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

  useEffect(() => {
    fetchJobs();

    // Set up realtime subscription
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
          console.log('Jobs updated, refreshing...');
          fetchJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
    };
    return labels[type] || type;
  };

  const filterJobs = (filterStatus: string) => {
    if (filterStatus === 'all') return jobs;
    if (filterStatus === 'active') {
      return jobs.filter(j => j.status === 'pending' || j.status === 'running');
    }
    return jobs.filter(j => j.status === filterStatus);
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
            job_id: jobId,
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
      const { error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: job.job_type,
          target_scope: job.target_scope,
          details: job.details,
        }
      });

      if (error) throw error;

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
    setSelectedJob(job);
    setDetailDialogOpen(true);
  };

  const renderJobsList = (filteredJobs: Job[]) => {
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
            <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">No jobs found</p>
            <p className="text-muted-foreground mb-4">
              Create your first job to start automating server management
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Job
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {filteredJobs.map((job) => (
          <ContextMenu key={job.id}>
            <ContextMenuTrigger asChild>
              <Card 
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => {
                  setSelectedJob(job);
                  setDetailDialogOpen(true);
                }}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(job.status)}
                      <div>
                        <h3 className="text-lg font-semibold">{getJobTypeLabel(job.job_type)}</h3>
                        <p className="text-sm text-muted-foreground">
                          Created {new Date(job.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(job.status)}
                  </div>
                  
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
        ))}
      </div>
    );
  };

  const activeJobs = filterJobs('active').length;
  const completedJobs = filterJobs('completed').length;
  const failedJobs = filterJobs('failed').length;

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Job Management</h1>
          <p className="text-muted-foreground">
            Create and monitor firmware updates, discovery scans, and automation jobs
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={fetchJobs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" asChild>
            <Link to="/settings?tab=activity-monitor">
              <Settings className="mr-2 h-4 w-4" />
              Job Settings
            </Link>
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Job
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3 mb-6">
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

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-6">
          {renderJobsList(filterJobs('all'))}
        </TabsContent>
        <TabsContent value="active" className="mt-6">
          {renderJobsList(filterJobs('active'))}
        </TabsContent>
        <TabsContent value="completed" className="mt-6">
          {renderJobsList(filterJobs('completed'))}
        </TabsContent>
        <TabsContent value="failed" className="mt-6">
          {renderJobsList(filterJobs('failed'))}
        </TabsContent>
      </Tabs>

      <CreateJobDialog 
        open={createDialogOpen} 
        onOpenChange={setCreateDialogOpen}
        onSuccess={fetchJobs}
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

export default Jobs;
