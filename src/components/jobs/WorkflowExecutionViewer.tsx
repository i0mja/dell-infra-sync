import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Loader2, 
  MinusCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface WorkflowExecutionViewerProps {
  jobId: string;
  workflowType: string;
  jobStatus?: string;
  jobDetails?: any;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface WorkflowStep {
  id: string;
  step_number: number;
  step_name: string;
  step_status: string;
  step_started_at: string | null;
  step_completed_at: string | null;
  step_details: any;
  step_error: string | null;
  server_id?: string | null;
  host_id?: string | null;
  cluster_id?: string | null;
  created_at: string;
  workflow_type: string;
  job_id: string;
}

export const WorkflowExecutionViewer = ({ 
  jobId, 
  workflowType,
  jobStatus,
  jobDetails,
  open,
  onOpenChange 
}: WorkflowExecutionViewerProps) => {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [currentOperation, setCurrentOperation] = useState<any>(null);

  useEffect(() => {
    fetchSteps();
    
    // Subscribe to realtime updates on workflow steps
    const workflowChannel = supabase
      .channel(`workflow-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workflow_executions',
          filter: `job_id=eq.${jobId}`
        },
        (payload) => {
          console.log('Workflow step updated:', payload);
          fetchSteps();
        }
      )
      .subscribe();
    
    // Subscribe to job details for real-time progress
    const jobChannel = supabase
      .channel(`job-details-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${jobId}`
        },
        (payload) => {
          if (payload.new && payload.new.details) {
            setCurrentOperation(payload.new.details);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(workflowChannel);
      supabase.removeChannel(jobChannel);
    };
  }, [jobId]);

  const fetchSteps = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('workflow_executions')
        .select('*')
        .eq('job_id', jobId)
        .order('step_number', { ascending: true });

      if (error) throw error;
      setSteps(data || []);
    } catch (error) {
      console.error('Error fetching workflow steps:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleStep = (stepId: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpandedSteps(newExpanded);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-5 w-5 text-muted-foreground" />;
      case 'running':
        return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'skipped':
        return <MinusCircle className="h-5 w-5 text-yellow-500" />;
      default:
        return <Clock className="h-5 w-5" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      pending: 'secondary',
      running: 'default',
      completed: 'default',
      failed: 'destructive',
      skipped: 'secondary'
    };

    return (
      <Badge variant={variants[status] || 'secondary'}>
        {status}
      </Badge>
    );
  };

  const calculateProgress = () => {
    if (steps.length === 0) return 0;
    const completed = steps.filter(s => ['completed', 'skipped'].includes(s.step_status)).length;
    return (completed / steps.length) * 100;
  };

  const getOverallStatus = () => {
    // If parent job has a terminal status, use it (especially important when no steps exist)
    if (jobStatus && ['failed', 'completed', 'cancelled'].includes(jobStatus)) {
      return jobStatus;
    }
    if (steps.length === 0) return jobStatus || 'pending';
    if (steps.some(s => s.step_status === 'failed')) return 'failed';
    if (steps.some(s => s.step_status === 'running')) return 'running';
    if (steps.every(s => ['completed', 'skipped'].includes(s.step_status))) return 'completed';
    return 'pending';
  };

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start) return '-';
    if (!end) return 'Running...';
    const duration = new Date(end).getTime() - new Date(start).getTime();
    const seconds = Math.floor(duration / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  if (loading && steps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading workflow execution...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const progress = calculateProgress();
  const overallStatus = getOverallStatus();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>
              {workflowType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </CardTitle>
            <CardDescription>Job ID: {jobId}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge(overallStatus)}
            <Button variant="ghost" size="icon" onClick={fetchSteps}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Operation - Real-time Progress */}
        {currentOperation && overallStatus === 'running' && (
          <>
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Current Operation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Current Step */}
                {currentOperation.current_step && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{currentOperation.current_step}</p>
                  </div>
                )}
                
                {/* SCP Progress Bar */}
                {currentOperation.scp_progress !== undefined && currentOperation.scp_progress > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Export Progress</span>
                      <span>{currentOperation.scp_progress}%</span>
                    </div>
                    <Progress value={currentOperation.scp_progress} className="h-1.5" />
                  </div>
                )}
                
                {/* Batch SCP Progress */}
                {currentOperation.hosts_backed_up !== undefined && currentOperation.total_hosts && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Hosts Backed Up</span>
                      <span>{currentOperation.hosts_backed_up}/{currentOperation.total_hosts}</span>
                    </div>
                    <Progress 
                      value={currentOperation.scp_batch_progress || ((currentOperation.hosts_backed_up / currentOperation.total_hosts) * 100)} 
                      className="h-1.5" 
                    />
                  </div>
                )}
                
                {/* Current Host */}
                {currentOperation.current_host && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Current Host: </span>
                    <span className="font-medium">{currentOperation.current_host}</span>
                  </div>
                )}
              </CardContent>
            </Card>
            <Separator />
          </>
        )}

        {/* Progress Summary */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Overall Progress</span>
            <span className="text-muted-foreground">
              {steps.filter(s => ['completed', 'skipped'].includes(s.step_status)).length} / {steps.length} steps
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <Separator />

        {/* Workflow Steps Timeline */}
        <div className="space-y-1">
          {steps.map((step, index) => {
            const isExpanded = expandedSteps.has(step.id);
            const hasDetails = step.step_details || step.step_error;

            return (
              <div key={step.id} className="relative">
                {/* Connecting line */}
                {index < steps.length - 1 && (
                  <div className="absolute left-[18px] top-10 bottom-[-16px] w-0.5 bg-border" />
                )}

                <Collapsible open={isExpanded} onOpenChange={() => hasDetails && toggleStep(step.id)}>
                  <div className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                    hasDetails ? 'cursor-pointer hover:bg-accent/50' : ''
                  }`}>
                    {/* Status Icon */}
                    <div className="relative z-10 mt-0.5">
                      {getStatusIcon(step.step_status)}
                    </div>

                    {/* Step Content */}
                    <div className="flex-1 min-w-0">
                      <CollapsibleTrigger asChild>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                {step.step_number}. {step.step_name}
                              </span>
                              {hasDetails && (
                                isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                              <span>
                                Duration: {formatDuration(step.step_started_at, step.step_completed_at)}
                              </span>
                              {step.step_completed_at && (
                                <span>
                                  {formatDistanceToNow(new Date(step.step_completed_at), { addSuffix: true })}
                                </span>
                              )}
                            </div>
                          </div>
                          {getStatusBadge(step.step_status)}
                        </div>
                      </CollapsibleTrigger>

                      {/* Expandable Details */}
                      {hasDetails && (
                        <CollapsibleContent className="mt-3">
                          {step.step_error && (
                            <Alert variant="destructive" className="mb-3">
                              <AlertDescription>{step.step_error}</AlertDescription>
                            </Alert>
                          )}
                          {step.step_details && (
                            <div className="bg-muted/50 rounded p-3 text-xs font-mono overflow-x-auto">
                              <pre>{JSON.stringify(step.step_details, null, 2)}</pre>
                            </div>
                          )}
                        </CollapsibleContent>
                      )}
                    </div>
                  </div>
                </Collapsible>
              </div>
            );
          })}
        </div>

        {steps.length === 0 && (
          <>
            {jobStatus === 'failed' && jobDetails?.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Job failed before workflow started:</strong>
                  <div className="mt-2 font-mono text-sm">{jobDetails.error}</div>
                </AlertDescription>
              </Alert>
            )}
            {jobStatus !== 'failed' && (
              <Alert>
                <AlertDescription>
                  No workflow steps recorded yet. The workflow may not have started.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
