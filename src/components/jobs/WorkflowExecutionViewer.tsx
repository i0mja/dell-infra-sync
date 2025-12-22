import { useEffect, useState, useRef, useMemo } from "react";
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
  PauseCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Monitor,
  ExternalLink
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { IdracJobQueuePanel } from "./IdracJobQueuePanel";
import { WorkflowStepDetails } from "./results/WorkflowStepDetails";
import { MaintenanceFailureDetails, FailedHost, BlockingVM } from "./results/MaintenanceFailureDetails";
import { MaintenanceBlockerAlert } from "@/components/maintenance/MaintenanceBlockerAlert";
import { BlockerResolutionWizard } from "@/components/maintenance/BlockerResolutionWizard";
import { HostBlockerAnalysis } from "@/lib/host-priority-calculator";
import { launchConsole } from "@/lib/job-executor-api";
import { toast } from "sonner";

interface WorkflowExecutionViewerProps {
  jobId: string;
  workflowType: string;
  jobStatus?: string;
  jobDetails?: any;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideHeader?: boolean;
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
  onOpenChange,
  hideHeader = false
}: WorkflowExecutionViewerProps) => {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [currentOperation, setCurrentOperation] = useState<any>(null);
  const [showBlockerWizard, setShowBlockerWizard] = useState(false);
  
  // Internal state to track job status/details independently
  const [internalJobStatus, setInternalJobStatus] = useState<string | null>(null);
  const [internalJobDetails, setInternalJobDetails] = useState<any>(null);
  
  // Console launch state
  const [consoleLaunching, setConsoleLaunching] = useState(false);
  const [consoleWindowOpen, setConsoleWindowOpen] = useState(false);
  const consoleWindowRef = useRef<Window | null>(null);

  // Use props if provided, otherwise use internal state
  const effectiveJobStatus = jobStatus || internalJobStatus;
  const effectiveJobDetails = jobDetails || internalJobDetails;

  useEffect(() => {
    fetchSteps();
    fetchJobData();
    
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
    
    // Subscribe to job details AND status for real-time progress
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
          if (payload.new) {
            if (payload.new.details) {
              setCurrentOperation(payload.new.details);
              setInternalJobDetails(payload.new.details);
            }
            if (payload.new.status) {
              setInternalJobStatus(payload.new.status as string);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(workflowChannel);
      supabase.removeChannel(jobChannel);
    };
  }, [jobId]);

  // Track console window open state
  useEffect(() => {
    const interval = setInterval(() => {
      if (consoleWindowRef.current) {
        if (consoleWindowRef.current.closed) {
          setConsoleWindowOpen(false);
          consoleWindowRef.current = null;
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Reset console state when current host changes
  useEffect(() => {
    setConsoleWindowOpen(false);
    consoleWindowRef.current = null;
  }, [currentOperation?.current_host_server_id]);

  const handleLaunchConsole = async () => {
    const serverId = currentOperation?.current_host_server_id;
    if (!serverId) return;
    
    setConsoleLaunching(true);
    try {
      const result = await launchConsole(serverId);
      
      if (result.success && result.console_url) {
        // Open in a new popup window sized for iDRAC console
        const popup = window.open(
          result.console_url,
          `console-${serverId}`,
          'width=1024,height=768,left=100,top=100,menubar=no,toolbar=no,location=no,status=no'
        );
        
        if (popup) {
          consoleWindowRef.current = popup;
          setConsoleWindowOpen(true);
          toast.success('Console opened', {
            description: `iDRAC console for ${currentOperation?.current_host || 'server'}`
          });
        } else {
          toast.error('Popup blocked', {
            description: 'Please allow popups to open the console'
          });
        }
      } else {
        toast.error('Failed to launch console', {
          description: result.error || 'Could not get console URL'
        });
      }
    } catch (error: any) {
      toast.error('Console launch failed', {
        description: error.message || 'Unknown error'
      });
    } finally {
      setConsoleLaunching(false);
    }
  };

  const fetchJobData = async () => {
    try {
      const { data } = await supabase
        .from('jobs')
        .select('status, details')
        .eq('id', jobId)
        .maybeSingle();
      
      if (data) {
        setInternalJobStatus(data.status);
        setInternalJobDetails(data.details);
        if (data.details) {
          setCurrentOperation(data.details);
        }
      }
    } catch (error) {
      console.error('Error fetching job data:', error);
    }
  };

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
      case 'paused':
        return <PauseCircle className="h-5 w-5 text-orange-500" />;
      case 'cancelled':
        return <XCircle className="h-5 w-5 text-orange-500" />;
      default:
        return <Clock className="h-5 w-5" />;
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'paused') {
      return (
        <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/30 hover:bg-orange-500/20">
          paused
        </Badge>
      );
    }

    // Cancelled gets custom orange styling
    if (status === 'cancelled') {
      return (
        <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/30 hover:bg-orange-500/20">
          cancelled
        </Badge>
      );
    }
    
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
    const details = effectiveJobDetails;
    
    // For rolling cluster updates, prefer host-based progress
    if (details?.total_hosts && details?.hosts_processed !== undefined) {
      return (details.hosts_processed / details.total_hosts) * 100;
    }
    
    // Use expected_total_steps if available for accurate percentage
    if (details?.expected_total_steps && steps.length > 0) {
      const completed = steps.filter(s => ['completed', 'skipped'].includes(s.step_status)).length;
      return (completed / details.expected_total_steps) * 100;
    }
    
    // Fallback to existing step count
    if (steps.length === 0) return 0;
    const completed = steps.filter(s => ['completed', 'skipped'].includes(s.step_status)).length;
    return (completed / steps.length) * 100;
  };

  const progressValue = useMemo(() => {
    const value = calculateProgress();
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      return 0;
    }
    return Math.min(100, Math.max(0, value));
  }, [effectiveJobDetails, steps]);

  const getOverallStatus = () => {
    // If job has a terminal status (from props or internal state), use it
    if (effectiveJobStatus && ['failed', 'completed', 'cancelled'].includes(effectiveJobStatus)) {
      return effectiveJobStatus;
    }
    if (effectiveJobStatus === 'paused') return 'paused';
    if (steps.length === 0) return effectiveJobStatus || 'pending';
    if (steps.some(s => s.step_status === 'failed')) return 'failed';
    if (steps.some(s => s.step_status === 'running')) return 'running';
    if (steps.every(s => ['completed', 'skipped'].includes(s.step_status))) return 'completed';
    return 'pending';
  };

  // Helper to get effective step status - treats running/pending as cancelled if job is cancelled
  const getEffectiveStepStatus = (stepStatus: string) => {
    if (effectiveJobStatus === 'paused' && ['running', 'pending'].includes(stepStatus)) {
      return 'paused';
    }
    if (effectiveJobStatus === 'cancelled' && ['running', 'pending'].includes(stepStatus)) {
      return 'cancelled';
    }
    return stepStatus;
  };

  const formatDuration = (start: string | null, end: string | null, stepStatus?: string) => {
    if (!start) return '-';
    // If step was running when job was cancelled, show "Cancelled" instead of "Running..."
    if (!end) {
      if (effectiveJobStatus === 'paused' && stepStatus === 'running') {
        return 'Paused';
      }
      if (effectiveJobStatus === 'cancelled' && stepStatus === 'running') {
        return 'Cancelled';
      }
      return 'Running...';
    }
    const duration = new Date(end).getTime() - new Date(start).getTime();
    const seconds = Math.floor(duration / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const getWorkflowDescription = () => {
    const descriptions: Record<string, string> = {
      rolling_cluster_update: 'This job updates an entire cluster host-by-host. It includes firmware updates, ESXi upgrades, configuration backups, and maintenance mode handling.',
      esxi_upgrade: 'This job upgrades ESXi on selected hosts with automated maintenance mode handling.',
      firmware_update: 'This job applies firmware updates to selected servers.',
      full_server_update: 'This job performs a complete server update including firmware and configuration.',
    };
    return descriptions[workflowType] || 'This job contains multiple workflow steps that execute in sequence.';
  };

  const normalizeVmReason = (reason?: string) => {
    if (!reason) return 'drs_no_destination';
    const normalized = reason.toLowerCase();
    if (normalized.includes('local storage')) return 'local_storage';
    if (normalized.includes('passthrough')) return 'passthrough';
    if (normalized.includes('affinity')) return 'affinity';
    if (normalized.includes('vcenter') || normalized.includes('vcsa')) return 'vcsa';
    if (normalized.includes('connected media')) return 'connected_media';
    if (normalized.includes('critical')) return 'critical_infra';
    if (normalized.includes('drs')) return 'drs_no_destination';
    return reason;
  };

  const buildBlockingVmsFromMaintenance = (maintenanceBlockers: any): BlockingVM[] => {
    if (!maintenanceBlockers?.blockers) return [];
    return maintenanceBlockers.blockers.map((blocker: any) => ({
      name: blocker.vm_name || 'Unknown VM',
      reason: normalizeVmReason(blocker.reason || blocker.details),
      drs_fault: blocker.details,
      power_off_eligible: blocker.auto_fixable
    }));
  };

  const buildBlockingVmsFromEvacuation = (evacuationBlockers: any): BlockingVM[] => {
    const vms = evacuationBlockers?.vms_remaining;
    if (!Array.isArray(vms)) return [];
    return vms.map((vm: any) => {
      if (typeof vm === 'string') {
        return {
          name: vm,
          reason: 'drs_no_destination'
        };
      }
      const rawReason = vm?.reason || vm?.power_state || 'DRS could not find suitable destination';
      return {
        name: vm?.name || 'Unknown VM',
        reason: normalizeVmReason(rawReason),
        drs_fault: typeof rawReason === 'string' ? rawReason : undefined
      };
    });
  };

  const failedHosts = useMemo(() => {
    const failedHostMap = new Map<string, FailedHost>();
    const hostResults = effectiveJobDetails?.workflow_results?.host_results ?? [];

    hostResults
      .filter((host: any) => host?.status === 'failed')
      .forEach((host: any) => {
        const maintenanceBlockers = host?.maintenance_blockers;
        const evacuationBlockers = host?.evacuation_blockers;
        const blockingVms = [
          ...buildBlockingVmsFromMaintenance(maintenanceBlockers),
          ...buildBlockingVmsFromEvacuation(evacuationBlockers)
        ];

        failedHostMap.set(host.host_name, {
          host_name: host.host_name || 'Unknown Host',
          error_type: evacuationBlockers ? 'vm_evacuation_failed' : maintenanceBlockers ? 'maintenance_blocked' : 'unknown',
          stalled_duration: host.stalled_duration || host.stall_duration_seconds,
          blocking_vms: blockingVms.length > 0 ? blockingVms : undefined,
          error_message: host.error || host.error_message
        });
      });

    steps
      .filter((step) => step.step_status === 'failed')
      .forEach((step) => {
        const nameParts = step.step_name.split(':');
        if (nameParts.length < 2) return;
        const hostName = nameParts.slice(1).join(':').trim();
        if (!hostName) return;

        const existing = failedHostMap.get(hostName);
        if (existing) {
          if (!existing.error_message && step.step_error) {
            existing.error_message = step.step_error;
          }
          if ((!existing.blocking_vms || existing.blocking_vms.length === 0) && step.step_details?.evacuation_blockers) {
            existing.blocking_vms = buildBlockingVmsFromEvacuation(step.step_details.evacuation_blockers);
          }
          failedHostMap.set(hostName, existing);
        } else {
          failedHostMap.set(hostName, {
            host_name: hostName,
            error_type: step.step_details?.evacuation_blockers ? 'vm_evacuation_failed' : 'unknown',
            blocking_vms: step.step_details?.evacuation_blockers
              ? buildBlockingVmsFromEvacuation(step.step_details.evacuation_blockers)
              : undefined,
            error_message: step.step_error
          });
        }
      });

    return Array.from(failedHostMap.values());
  }, [effectiveJobDetails, steps]);

  const workflowBlockers = useMemo(() => {
    const blockers: Record<string, HostBlockerAnalysis> = {};

    const hostResults = effectiveJobDetails?.workflow_results?.host_results ?? [];
    hostResults.forEach((host: any, index: number) => {
      const maintenanceBlockers = host?.maintenance_blockers;
      if (!maintenanceBlockers?.blockers?.length) return;
      const hostId =
        maintenanceBlockers.host_id ||
        host?.host_id ||
        host?.server_id ||
        host?.host_name ||
        `host-${index}`;
      blockers[hostId] = {
        host_id: hostId,
        host_name: maintenanceBlockers.host_name || host?.host_name || 'Unknown Host',
        can_enter_maintenance: maintenanceBlockers.can_enter_maintenance ?? false,
        blockers: maintenanceBlockers.blockers ?? [],
        warnings: maintenanceBlockers.warnings ?? [],
        total_powered_on_vms: maintenanceBlockers.total_powered_on_vms ?? 0,
        migratable_vms: maintenanceBlockers.migratable_vms ?? 0,
        blocked_vms:
          maintenanceBlockers.blocked_vms ?? maintenanceBlockers.blockers?.length ?? 0,
        estimated_evacuation_time: maintenanceBlockers.estimated_evacuation_time ?? 0
      };
    });

    steps
      .filter((step) => step.step_status === 'failed')
      .forEach((step, index) => {
        const maintenanceBlockers = step.step_details?.maintenance_blockers;
        if (!maintenanceBlockers?.blockers?.length) return;
        const hostId =
          maintenanceBlockers.host_id ||
          step.step_details?.host_id ||
          step.host_id ||
          step.server_id ||
          `step-host-${index}`;
        if (blockers[hostId]) return;
        const inferredHostName = step.step_name?.split(':').slice(1).join(':').trim();
        blockers[hostId] = {
          host_id: hostId,
          host_name: maintenanceBlockers.host_name || inferredHostName || 'Unknown Host',
          can_enter_maintenance: maintenanceBlockers.can_enter_maintenance ?? false,
          blockers: maintenanceBlockers.blockers ?? [],
          warnings: maintenanceBlockers.warnings ?? [],
          total_powered_on_vms: maintenanceBlockers.total_powered_on_vms ?? 0,
          migratable_vms: maintenanceBlockers.migratable_vms ?? 0,
          blocked_vms:
            maintenanceBlockers.blocked_vms ?? maintenanceBlockers.blockers?.length ?? 0,
          estimated_evacuation_time: maintenanceBlockers.estimated_evacuation_time ?? 0
        };
      });

    return blockers;
  }, [effectiveJobDetails, steps]);

  const workflowBlockerDetails = useMemo(() => {
    return Object.values(workflowBlockers).flatMap((analysis) =>
      analysis.blockers.map((blocker) => ({
        ...blocker,
        vm_name: `${blocker.vm_name} (${analysis.host_name})`
      }))
    );
  }, [workflowBlockers]);

  return (
    <Card>
      {!hideHeader && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">
                  {workflowType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </CardTitle>
                {getStatusBadge(overallStatus)}
              </div>
              <CardDescription className="text-xs">
                Job ID: <span className="font-mono">{jobId.slice(0, 8)}</span>
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={fetchSteps}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Job hierarchy explanation */}
          <div className="mt-3 p-3 rounded-md bg-muted/50 border border-border/50">
            <p className="text-xs text-muted-foreground">
              {getWorkflowDescription()}
            </p>
            {steps.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-medium text-foreground">{steps.length} workflow steps</span> are part of this single job.
              </p>
            )}
          </div>
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        {/* Current Operation - Real-time Progress */}
        {currentOperation && (overallStatus === 'running' || overallStatus === 'paused') && (
          <>
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {overallStatus === 'paused' ? (
                      <PauseCircle className="h-4 w-4 text-orange-500" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    )}
                    {overallStatus === 'paused' ? 'Paused for Intervention' : 'Current Operation'}
                  </CardTitle>
                  
                  {/* Console Launch Button */}
                  {currentOperation.current_host_server_id && (
                    <div className="flex items-center gap-2">
                      {consoleWindowOpen && (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                          <Monitor className="h-3 w-3 mr-1" />
                          Console Open
                        </Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLaunchConsole}
                        disabled={consoleLaunching}
                        className="h-7 text-xs"
                      >
                        {consoleLaunching ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <ExternalLink className="h-3 w-3 mr-1" />
                        )}
                        {consoleLaunching ? 'Opening...' : 'View Console'}
                      </Button>
                    </div>
                  )}
                </div>
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
                    {currentOperation.current_host_ip && (
                      <span className="text-muted-foreground ml-1">({currentOperation.current_host_ip})</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* iDRAC Job Queue - Real hardware job status */}
            {currentOperation?.idrac_job_queue && currentOperation.idrac_job_queue.length > 0 && (
              <IdracJobQueuePanel 
                jobs={currentOperation.idrac_job_queue}
                updatedAt={currentOperation.idrac_queue_updated_at}
                serverIp={currentOperation.current_host_ip}
              />
            )}
            
            <Separator />
          </>
        )}

        {/* Progress Summary */}
        <div className="space-y-3">
          {/* Host-based progress (primary for rolling updates) */}
          {effectiveJobDetails?.total_hosts && (
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Host Progress</span>
              <span className="text-muted-foreground">
                {effectiveJobDetails.hosts_processed || 0} / {effectiveJobDetails.total_hosts} hosts
              </span>
            </div>
          )}
          
          {/* Step-based progress (secondary detail) */}
          <div className="flex items-center justify-between text-sm">
            <span>Workflow Steps</span>
            <span className="text-muted-foreground">
              {steps.filter(s => ['completed', 'skipped'].includes(s.step_status)).length} / {effectiveJobDetails?.expected_total_steps || steps.length} steps
            </span>
          </div>
          
          <Progress 
            value={progressValue} 
            className={`h-2 ${overallStatus === 'cancelled' ? '[&>div]:bg-orange-500' : ''}`} 
          />
        </div>

        {/* Host-Specific Errors from workflow results or steps */}
        {failedHosts.length > 0 && (
          <>
            <Separator />
            {workflowBlockerDetails.length > 0 && (
              <MaintenanceBlockerAlert
                blockerDetails={workflowBlockerDetails}
                onResolveBlockers={() => setShowBlockerWizard(true)}
                className="mb-4"
              />
            )}
            <MaintenanceFailureDetails failedHosts={failedHosts} jobId={jobId} />
          </>
        )}

        {/* Skipped Hosts - show when hosts were skipped due to being up-to-date */}
        {effectiveJobDetails?.workflow_results?.host_results?.some((h: any) => h.status === 'skipped' && h.no_updates_needed) && (
          <>
            <Separator />
            <Card className="border-yellow-500/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-yellow-600 dark:text-yellow-500 flex items-center gap-2">
                  <MinusCircle className="h-4 w-4" />
                  Skipped Hosts (Already Up-to-Date)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {effectiveJobDetails.workflow_results.host_results
                    .filter((h: any) => h.status === 'skipped' && h.no_updates_needed)
                    .map((host: any, idx: number) => (
                      <div key={idx} className="p-2 rounded bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-between">
                        <div className="font-medium text-sm">{host.host_name}</div>
                        <Badge variant="secondary" className="text-xs">No updates needed</Badge>
                      </div>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  These hosts were checked for updates but no applicable firmware updates were found. 
                  They were skipped without entering maintenance mode.
                </p>
              </CardContent>
            </Card>
          </>
        )}

        {/* Job-Level Error - only show if NO host-specific errors (avoid duplication) */}
        {overallStatus === 'failed' && effectiveJobDetails?.error && failedHosts.length === 0 && (
          <>
            <Separator />
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription className="mt-2">
                <div className="font-semibold mb-1">Job Failed</div>
                <div className="font-mono text-xs whitespace-pre-wrap">
                  {effectiveJobDetails.error}
                </div>
              </AlertDescription>
            </Alert>
          </>
        )}

        {overallStatus === 'paused' && (
          <>
            <Separator />
            <Alert className="border-orange-500/50 bg-orange-500/10">
              <PauseCircle className="h-4 w-4 text-orange-500" />
              <AlertDescription className="mt-2">
                <div className="font-semibold mb-1 text-orange-600">Workflow Paused</div>
                <div className="text-xs text-muted-foreground">
                  {effectiveJobDetails?.pause_reason || 'Operator intervention required before continuing.'}
                </div>
              </AlertDescription>
            </Alert>
          </>
        )}

        {showBlockerWizard && Object.keys(workflowBlockers).length > 0 && (
          <BlockerResolutionWizard
            open={showBlockerWizard}
            onOpenChange={setShowBlockerWizard}
            hostBlockers={workflowBlockers}
            onComplete={(resolutions, hostOrder) => {
              console.log('Blocker resolutions:', resolutions, 'Host order:', hostOrder);
              setShowBlockerWizard(false);
              toast.success('Blocker resolutions saved. Retry the job when ready.');
            }}
          />
        )}

        {/* Cancellation Report */}
        {overallStatus === 'cancelled' && (
          <>
            <Separator />
            <Alert className="border-orange-500/50 bg-orange-500/10">
              <XCircle className="h-4 w-4 text-orange-500" />
              <AlertDescription className="mt-2">
                <div className="font-semibold mb-2 text-orange-600">Job Cancelled</div>
                
                {effectiveJobDetails?.cancelled_during && (
                  <div className="text-sm mb-2">
                    <span className="text-muted-foreground">Cancelled during: </span>
                    <span className="font-medium">{effectiveJobDetails.cancelled_during.replace(/_/g, ' ')}</span>
                  </div>
                )}
                
                {effectiveJobDetails?.cleanup_performed !== undefined && (
                  <div className="mb-2">
                    {effectiveJobDetails.cleanup_performed ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Cleanup completed
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
                        <Clock className="h-3 w-3 mr-1" />
                        No cleanup needed
                      </Badge>
                    )}
                  </div>
                )}

                {/* Show workflow results summary */}
                {effectiveJobDetails?.workflow_results && (
                  <div className="mt-3 pt-3 border-t border-orange-500/20 space-y-1 text-sm">
                    <div className="text-muted-foreground">Summary:</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>Total hosts: <span className="font-medium">{effectiveJobDetails.workflow_results.total_hosts || 0}</span></div>
                      <div>Hosts updated: <span className="font-medium text-green-600">{effectiveJobDetails.workflow_results.hosts_updated || 0}</span></div>
                      <div>Hosts skipped: <span className="font-medium text-yellow-600">{effectiveJobDetails.workflow_results.hosts_skipped || 0}</span></div>
                      <div>Hosts failed: <span className="font-medium text-destructive">{effectiveJobDetails.workflow_results.hosts_failed || 0}</span></div>
                    </div>
                  </div>
                )}

                {/* Show current host info if available */}
                {effectiveJobDetails?.current_host && (
                  <div className="mt-3 pt-3 border-t border-orange-500/20 text-xs">
                    <span className="text-muted-foreground">Last active host: </span>
                    <span className="font-medium">{effectiveJobDetails.current_host}</span>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          </>
        )}

        <Separator />

        {/* Workflow Steps Timeline */}
        {steps.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span className="px-2 font-medium uppercase tracking-wide">Workflow Steps</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}
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
                      {getStatusIcon(getEffectiveStepStatus(step.step_status))}
                    </div>

                    {/* Step Content */}
                    <div className="flex-1 min-w-0">
                      <CollapsibleTrigger asChild>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                {step.step_name}
                              </span>
                              {hasDetails && (
                                isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                              <span>
                                Duration: {formatDuration(step.step_started_at, step.step_completed_at, step.step_status)}
                              </span>
                              {step.step_completed_at && (
                                <span>
                                  {formatDistanceToNow(new Date(step.step_completed_at), { addSuffix: true })}
                                </span>
                              )}
                            </div>
                          </div>
                          {getStatusBadge(getEffectiveStepStatus(step.step_status))}
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
                            <WorkflowStepDetails 
                              stepName={step.step_name}
                              stepNumber={step.step_number}
                              details={step.step_details}
                            />
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
