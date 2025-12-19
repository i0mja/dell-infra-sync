import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useJobProgress, formatElapsed } from "@/hooks/useJobProgress";
import { Clock, Server, Database, Globe, Layers, HardDrive, Network, Monitor, AlertTriangle, CheckCircle2, XCircle, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { VCenterSyncProgress } from "./VCenterSyncProgress";

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

interface JobProgressHeaderProps {
  job: Job;
}

export const JobProgressHeader = ({ job }: JobProgressHeaderProps) => {
  const { data: progress, isLoading: progressLoading } = useJobProgress(job.id);
  const [elapsed, setElapsed] = useState<string>('');
  
  // Use job.details as fallback while hook loads
  const currentStep = progress?.currentStep || job.details?.current_step;
  const progressPercent = progress?.progressPercent ?? job.details?.progress_percent ?? 0;
  // Update elapsed time every second for running jobs
  useEffect(() => {
    if (job.status === 'running' && job.started_at) {
      const interval = setInterval(() => {
        setElapsed(formatElapsed(job.started_at));
      }, 1000);
      return () => clearInterval(interval);
    } else if (job.started_at && job.completed_at) {
      const ms = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        setElapsed(`${hours}h ${minutes % 60}m`);
      } else if (minutes > 0) {
        setElapsed(`${minutes}m ${seconds % 60}s`);
      } else {
        setElapsed(`${seconds}s`);
      }
    }
  }, [job.status, job.started_at, job.completed_at]);

  const formatJobType = (type: string) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getTargetInfo = () => {
    const scope = job.target_scope;
    const details = job.details;

    // vCenter sync - show more detail (prefer current_vcenter_name for running multi-vCenter jobs)
    if (job.job_type === 'vcenter_sync') {
      const vcenterName = details?.current_vcenter_name || details?.vcenter_name || details?.vcenter_host;
      if (vcenterName) {
        // Only show IP if we have both current_vcenter_name and vcenter_host (i.e., currently syncing)
        const showIp = details?.vcenter_host && details?.current_vcenter_name;
        return (
          <div className="flex items-center gap-2 text-sm">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{vcenterName}</span>
            {showIp && (
              <span className="text-muted-foreground">({details.vcenter_host})</span>
            )}
          </div>
        );
      }
    }

    // Discovery scan
    if (job.job_type === 'discovery_scan' && details?.ip_range) {
      return (
        <div className="flex items-center gap-2 text-sm">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{details.ip_range}</span>
        </div>
      );
    }

    // Server-based jobs
    if (scope?.server_ids?.length) {
      return (
        <div className="flex items-center gap-2 text-sm">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">
            {scope.server_ids.length} {scope.server_ids.length === 1 ? 'server' : 'servers'}
          </span>
        </div>
      );
    }

    // All servers
    if (scope?.type === 'all') {
      return (
        <div className="flex items-center gap-2 text-sm">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">All Servers</span>
        </div>
      );
    }

    return null;
  };

  // Check if this is a vCenter sync job that's running
  const isVCenterSyncRunning = job.job_type === 'vcenter_sync' && job.status === 'running';
  
  // Check if this is a failover preflight check job
  const isFailoverPreflight = job.job_type === 'failover_preflight_check';
  const stepResults = progress?.details?.step_results || job.details?.step_results;

  const getStatusColor = () => {
    switch (job.status) {
      case 'running':
        return 'text-primary';
      case 'completed':
        return 'text-success';
      case 'failed':
        return 'text-destructive';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <Card className="border-l-4" style={{
      borderLeftColor: job.status === 'running' ? 'hsl(var(--primary))' : 
                       job.status === 'completed' ? 'hsl(var(--success))' : 
                       job.status === 'failed' ? 'hsl(var(--destructive))' : 'hsl(var(--border))'
    }}>
      <CardContent className="pt-6 space-y-4">
        {/* Job Type and Status */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-xl font-semibold">{formatJobType(job.job_type)}</h3>
            {getTargetInfo()}
          </div>
          <Badge 
            variant={
              job.status === 'completed' ? 'secondary' : 
              job.status === 'failed' ? 'destructive' : 
              job.status === 'running' ? 'default' : 'outline'
            }
            className={job.status === 'running' ? 'animate-pulse' : ''}
          >
            {job.status}
          </Badge>
        </div>

        {/* Current Step - show immediately from job.details or progress */}
        {currentStep && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-medium">Current step:</span>
              <span className="font-mono">{currentStep}</span>
            </div>
          </div>
        )}

        {/* Optimistic loading state while progress hook loads */}
        {job.status === 'running' && progressLoading && !currentStep && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>Initializing...</span>
            </div>
          </div>
        )}

        {/* Progress Bar - show immediately with fallback values */}
        {job.status === 'running' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        )}

        {/* Elapsed Time */}
        {elapsed && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              {job.status === 'running' ? 'Running for' : 'Completed in'} <span className="font-medium">{elapsed}</span>
            </span>
          </div>
        )}

        {/* vCenter Sync Phase Progress */}
        {isVCenterSyncRunning && (
          <VCenterSyncProgress 
            details={progress?.details || job.details} 
            currentStep={progress?.currentStep} 
          />
        )}

        {/* Failover Preflight Check Progress */}
        {isFailoverPreflight && job.status === 'running' && stepResults && stepResults.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Shield className="h-4 w-4" />
              <span>Pre-flight checks progress</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {stepResults.map((step: { step: string; status: string; passed: boolean }, idx: number) => (
                <Badge 
                  key={idx}
                  variant={step.status === 'success' ? 'secondary' : step.status === 'warning' ? 'outline' : 'destructive'}
                  className="text-xs flex items-center gap-1"
                >
                  {step.status === 'success' ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : step.status === 'warning' ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : (
                    <XCircle className="h-3 w-3" />
                  )}
                  {step.step}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
