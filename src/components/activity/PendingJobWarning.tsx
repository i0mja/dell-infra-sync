import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Clock, AlertTriangle, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Job {
  id: string;
  status: string;
  job_type: string;
  created_at: string;
}

interface PendingJobWarningProps {
  job: Job;
  onCancel?: () => void;
}

// Job types that require the local job executor
const EXECUTOR_REQUIRED_JOBS = [
  'firmware_update',
  'ip_discovery',
  'vcenter_sync',
  'esxi_upgrade',
  'failover_preflight_check',
  'group_failover',
  'test_failover',
  'planned_failover',
  'unplanned_failover',
  'replication_sync',
  'sla_check',
  'cluster_safety_check',
  'bios_capture',
  'bios_apply',
  'scp_backup',
  'scp_restore',
  'idrac_network_capture',
  'full_server_update',
  'mount_iso',
  'unmount_iso',
  'power_on',
  'power_off',
  'power_cycle',
  'graceful_shutdown',
  'credential_test',
  'connectivity_test',
];

export function PendingJobWarning({ job, onCancel }: PendingJobWarningProps) {
  const [pendingDuration, setPendingDuration] = useState(0);

  useEffect(() => {
    if (job.status !== 'pending') return;

    const updateDuration = () => {
      const created = new Date(job.created_at);
      const now = new Date();
      setPendingDuration(Math.floor((now.getTime() - created.getTime()) / 1000));
    };

    updateDuration();
    const interval = setInterval(updateDuration, 1000);
    return () => clearInterval(interval);
  }, [job.status, job.created_at]);

  // Only show warning for jobs pending > 30 seconds that need executor
  const requiresExecutor = EXECUTOR_REQUIRED_JOBS.includes(job.job_type);
  const showWarning = job.status === 'pending' && pendingDuration > 30 && requiresExecutor;

  if (!showWarning) return null;

  const pendingTime = formatDistanceToNow(new Date(job.created_at), { addSuffix: false });

  return (
    <Alert variant="default" className="border-amber-500/50 bg-amber-500/5">
      <AlertTriangle className="h-4 w-4 text-amber-500" />
      <AlertTitle className="text-amber-500 flex items-center gap-2">
        <Clock className="h-4 w-4" />
        Waiting for Job Executor ({pendingTime})
      </AlertTitle>
      <AlertDescription className="text-sm mt-2 space-y-2">
        <p className="text-muted-foreground">
          This job requires the <strong>Job Executor</strong> to be running on your local network. 
          The executor polls for pending jobs and processes them.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button 
            variant="outline" 
            size="sm" 
            className="h-7 text-xs"
            onClick={() => window.open('/settings/system', '_self')}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Check System Settings
          </Button>
          {onCancel && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={onCancel}
            >
              Cancel Job
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground/70 pt-1">
          Run: <code className="bg-muted px-1 py-0.5 rounded">python job-executor.py</code>
        </p>
      </AlertDescription>
    </Alert>
  );
}
