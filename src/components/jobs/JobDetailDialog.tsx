import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, PlayCircle, Clock, AlertCircle, FileCode, ListChecks, Activity, Link2, ExternalLink, Calendar, Minimize2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WorkflowExecutionViewer } from "./WorkflowExecutionViewer";
import { useMinimizedJobs } from "@/contexts/MinimizedJobsContext";
import { ApiCallStream } from "./ApiCallStream";
import { DiscoveryScanResults, VCenterSyncResults, CredentialTestResults, ScpResults, MultiServerResults, GenericResults, JobTimingCard, EsxiUpgradeResults, EsxiPreflightResults, JobProgressHeader, JobTasksTimeline, JobConsoleLog, StorageVMotionResults, ZfsDeploymentResults } from "./results";
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
interface ParentWindow {
  id: string;
  title: string;
  status: string;
  maintenance_type: string;
  planned_start: string;
}
interface JobDetailDialogProps {
  job: Job | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewWindow?: (windowId: string) => void;
}
type IdracCommand = {
  id: string;
  endpoint: string;
  status_code: number | null;
  error_message: string | null;
  response_body: any;
  created_at: string;
  operation_type: string | null;
  command_type: string | null;
  success: boolean | null;
};
export const JobDetailDialog = ({
  job,
  open,
  onOpenChange,
  onViewWindow
}: JobDetailDialogProps) => {
  const [subJobs, setSubJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [idracCommands, setIdracCommands] = useState<IdracCommand[]>([]);
  const [idracLoading, setIdracLoading] = useState(false);
  const [parentWindow, setParentWindow] = useState<ParentWindow | null>(null);
  const {
    minimizeJob
  } = useMinimizedJobs();

  // Check if this is a workflow job type (safe even when job is null)
  const workflowJobTypes = ['prepare_host_for_update', 'verify_host_after_update', 'rolling_cluster_update'];
  const isWorkflowJob = job ? workflowJobTypes.includes(job.job_type) : false;
  useEffect(() => {
    if (!open || !job) return;

    // Check if this job belongs to a maintenance window
    fetchParentWindow();
    if (isWorkflowJob) return;
    fetchIdracCommands();

    // Fetch sub-jobs for full_server_update jobs
    if (job.job_type === 'full_server_update') {
      fetchSubJobs();
    }

    // Subscribe to sub-jobs updates if this is a full server update
    const jobsChannel = job.job_type === 'full_server_update' ? supabase.channel(`sub-jobs-${job.id}`).on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'jobs',
      filter: `parent_job_id=eq.${job.id}`
    }, () => {
      console.log('Sub-jobs updated');
      fetchSubJobs();
    }).subscribe() : null;
    setLoading(false);
    return () => {
      if (jobsChannel) {
        supabase.removeChannel(jobsChannel);
      }
    };
  }, [open, job, isWorkflowJob]);

  // Early return if no job selected (after all hooks)
  if (!job) {
    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Job Details</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">No job selected</p>
        </DialogContent>
      </Dialog>;
  }
  const fetchParentWindow = async () => {
    if (!job) return;
    try {
      // Find any maintenance window that has this job in its job_ids
      // Use overlaps instead of contains for better UUID array compatibility
      const {
        data,
        error
      } = await supabase.from('maintenance_windows').select('id, title, status, maintenance_type, planned_start').overlaps('job_ids', [job.id]).limit(1).maybeSingle();
      if (error) {
        // 406 errors can occur with array queries - handle gracefully
        if (error.code === '406' || error.message?.includes('406')) {
          console.warn('Array query not supported, skipping parent window lookup');
          setParentWindow(null);
          return;
        }
        if (error.code !== 'PGRST116') {
          // PGRST116 = no rows returned
          console.error('Error fetching parent window:', error);
        }
      }
      setParentWindow(data || null);
    } catch (error) {
      console.error('Error fetching parent window:', error);
      setParentWindow(null);
    }
  };
  const fetchSubJobs = async () => {
    if (!job) return;
    try {
      const {
        data,
        error
      } = await supabase.from("jobs").select("*").eq("parent_job_id", job.id).order("component_order", {
        ascending: true
      });
      if (error) throw error;
      setSubJobs(data || []);
    } catch (error) {
      console.error("Error fetching sub-jobs:", error);
    }
  };
  const fetchIdracCommands = async () => {
    if (!job) return;
    try {
      setIdracLoading(true);
      const {
        data,
        error
      } = await supabase.from('idrac_commands').select('id, endpoint, status_code, error_message, response_body, created_at, operation_type, command_type, success').eq('job_id', job.id).order('created_at', {
        ascending: false
      }).limit(5);
      if (error) throw error;
      setIdracCommands(data || []);
    } catch (error) {
      console.error('Error fetching iDRAC commands:', error);
    } finally {
      setIdracLoading(false);
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
      pending: "outline"
    };
    return (
      <Badge variant={variants[status] || "outline"} className="capitalize">
        {status}
      </Badge>
    );
  };
  const validationErrors = job.details?.validation_errors;
  const formatValidationErrors = () => {
    if (!validationErrors) return [] as string[];
    if (Array.isArray(validationErrors)) return validationErrors.map(String);
    if (typeof validationErrors === 'object') {
      return Object.entries(validationErrors).map(([key, value]) => `${key}: ${value}`);
    }
    return [String(validationErrors)];
  };
  const failingCommand = idracCommands.find(cmd => cmd.success === false || (cmd.status_code ?? 0) >= 400) || idracCommands[0];
  const renderResponseBody = (body: any) => {
    if (!body) return 'No response body provided by iDRAC.';
    if (typeof body === 'string') return body;
    try {
      return JSON.stringify(body, null, 2);
    } catch (error) {
      console.error('Error stringifying response body:', error);
      return 'Unable to display iDRAC response body';
    }
  };

  // Job-type-specific result renderer
  const JobResultsCard = ({
    job
  }: {
    job: Job;
  }) => {
    switch (job.job_type) {
      case 'discovery_scan':
        return <DiscoveryScanResults details={job.details} />;
      case 'vcenter_sync':
        return <VCenterSyncResults details={job.details} />;
      case 'test_credentials':
        return <CredentialTestResults details={job.details} />;
      case 'scp_export':
      case 'scp_import':
        return <ScpResults details={job.details} jobType={job.job_type} />;
      case 'boot_configuration':
      case 'firmware_update':
      case 'power_control':
        return <MultiServerResults details={job.details} />;
      case 'esxi_upgrade':
      case 'esxi_then_firmware':
      case 'firmware_then_esxi':
        return <EsxiUpgradeResults details={job.details} jobType={job.job_type} />;
      case 'esxi_preflight_check':
        return <EsxiPreflightResults details={job.details} />;
      case 'storage_vmotion':
        return <StorageVMotionResults details={job.details} status={job.status} />;
      case 'deploy_zfs_target':
        return <ZfsDeploymentResults details={job.details} status={job.status} />;
      default:
        return <GenericResults details={job.details} />;
    }
  };

  // Parent window banner component
  const ParentWindowBanner = () => {
    if (!parentWindow) return null;
    return <div className="mb-4 p-3 bg-muted/50 border rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Part of Maintenance Window</p>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {parentWindow.title}
            </p>
          </div>
        </div>
        {onViewWindow && <Button variant="outline" size="sm" onClick={() => onViewWindow(parentWindow.id)}>
            <ExternalLink className="h-3 w-3 mr-1" />
            View Window
          </Button>}
      </div>;
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
      {isWorkflowJob ? <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>
                  {job.job_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </DialogTitle>
                <DialogDescription>
                  Workflow execution details for job {job.id}
                </DialogDescription>
              </div>
              {(job.status === 'running' || job.status === 'pending') && <Button variant="ghost" size="icon" onClick={() => {
            minimizeJob(job.id, job.job_type);
            onOpenChange(false);
          }} title="Minimize to floating monitor">
                  <Minimize2 className="h-4 w-4" />
                </Button>}
            </div>
          </DialogHeader>
          <ParentWindowBanner />
          <WorkflowExecutionViewer jobId={job.id} workflowType={job.job_type} jobStatus={job.status} jobDetails={job.details} hideHeader={true} />
        </DialogContent> : <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Job Details</DialogTitle>
              {getStatusBadge(job.status)}
            </div>
          </DialogHeader>

          <ParentWindowBanner />

          <Tabs defaultValue="progress" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="progress">Progress</TabsTrigger>
              <TabsTrigger value="console">Console</TabsTrigger>
              <TabsTrigger value="results">Results</TabsTrigger>
              <TabsTrigger value="api-calls">
                <Activity className="h-4 w-4 mr-2" />
                API Activity
              </TabsTrigger>
            </TabsList>

            <TabsContent value="progress" className="space-y-4 mt-4">
              <JobProgressHeader job={job} />
              {/* Hide task timeline for vcenter_sync jobs since VCenterSyncProgress shows phase progress */}
              {job.job_type !== 'vcenter_sync' && <JobTasksTimeline jobId={job.id} />}
            </TabsContent>

            <TabsContent value="console" className="mt-4">
              <JobConsoleLog jobId={job.id} />
            </TabsContent>

            <TabsContent value="results" className="space-y-6 mt-4">
              {/* Job Timing */}
              <JobTimingCard job={job} />

              {job.details?.notes && <Card>
                  <CardContent className="pt-6">
                    <span className="text-sm text-muted-foreground">Notes:</span>
                    <p className="text-sm mt-1">{job.details.notes}</p>
                  </CardContent>
                </Card>}

            {/* Error Alert for Failed Jobs */}
            {job.status === 'failed' && job.details?.error && <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Job Failed</AlertTitle>
                <AlertDescription className="mt-2">
                  <div className="font-mono text-sm whitespace-pre-wrap">
                    {job.details.error}
                  </div>
                </AlertDescription>
              </Alert>}

            {/* Validation Errors */}
            {job.status === 'failed' && validationErrors && <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-destructive" />
                    <CardTitle className="text-base">Validation issues that blocked this job</CardTitle>
                  </div>
                  <Badge variant="destructive">Validation failed</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  {formatValidationErrors().map((err, idx) => <div key={idx} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 text-destructive">•</span>
                      <span className="font-mono text-destructive/80 whitespace-pre-wrap">{err}</span>
                    </div>)}
                  <p className="text-xs text-muted-foreground">
                    Fix the validation errors above and retry the job.
                  </p>
                </CardContent>
              </Card>}

            {/* iDRAC Response Details */}
            {job.status === 'failed' && <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-destructive" />
                    <CardTitle className="text-base">iDRAC response that triggered failure</CardTitle>
                  </div>
                  {failingCommand?.status_code && <Badge variant={failingCommand.status_code >= 400 ? 'destructive' : 'secondary'}>
                      HTTP {failingCommand.status_code}
                    </Badge>}
                </CardHeader>
                <CardContent className="space-y-3">
                  {idracLoading ? <p className="text-sm text-muted-foreground">Loading iDRAC command details...</p> : failingCommand ? <div className="space-y-3">
                      <div className="space-y-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Endpoint</span>
                          <Badge variant="outline">{failingCommand.command_type || failingCommand.operation_type || 'iDRAC API'}</Badge>
                        </div>
                        <p className="font-mono break-all text-xs bg-muted p-2 rounded">{failingCommand.endpoint}</p>
                      </div>
                      {failingCommand.error_message && <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Rejected by iDRAC</AlertTitle>
                          <AlertDescription className="mt-1 text-sm font-mono whitespace-pre-wrap">
                            {failingCommand.error_message}
                          </AlertDescription>
                        </Alert>}
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Raw response</p>
                        <ScrollArea className="h-48 rounded border bg-muted p-3">
                          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                            {renderResponseBody(failingCommand.response_body)}
                          </pre>
                        </ScrollArea>
                        <p className="text-xs text-muted-foreground">
                          Captured at {new Date(failingCommand.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div> : <p className="text-sm text-muted-foreground">No iDRAC responses were logged for this job.</p>}
                </CardContent>
              </Card>}

            {/* Health Check Failure Details */}
            {job.status === 'failed' && job.job_type === 'health_check' && job.details?.failed_servers && <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Health Check Failures ({job.details.failed_count}/{job.details.total})</AlertTitle>
                <AlertDescription className="mt-2">
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2">
                      {job.details.failed_servers.map((failure: any, idx: number) => <div key={idx} className="p-2 bg-destructive/10 rounded border border-destructive/20">
                          <div className="font-medium">{failure.ip_address}</div>
                          <div className="text-sm font-mono mt-1">{failure.error}</div>
                        </div>)}
                    </div>
                  </ScrollArea>
                </AlertDescription>
              </Alert>}

              {/* Job-Type-Specific Results - show for all statuses for jobs that have detailed progress */}
              {(job.status === 'completed' || job.job_type === 'deploy_zfs_target') && <JobResultsCard job={job} />}

              {/* Sub-Jobs List (for full_server_update) */}
              {job.job_type === 'full_server_update' && subJobs.length > 0 && <Card>
                  <CardContent className="pt-6">
                    <h3 className="font-semibold mb-4">Component Updates ({subJobs.length})</h3>
                    <div className="space-y-2">
                      {subJobs.map(subJob => <div key={subJob.id} className="flex items-center justify-between p-3 border rounded-lg">
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
                        </div>)}
                    </div>
                  </CardContent>
                </Card>}
            </TabsContent>

            <TabsContent value="api-calls" className="mt-4">
              <ApiCallStream jobId={job.id} />
            </TabsContent>
          </Tabs>
        </DialogContent>}
    </Dialog>;
};