import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Database, CheckCircle2, XCircle, Clock, HardDrive, ArrowRight, AlertCircle, Server, AlertTriangle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";
import { forceCompleteReplicationJob } from "@/lib/stale-job-recovery";
import { toast } from "sonner";

interface ReplicationSyncResultsProps {
  details: any;
  status: string;
  jobId?: string;
  onJobRecovered?: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '-';
  const start = new Date(startedAt);
  const end = completedAt ? new Date(completedAt) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export const ReplicationSyncResults = ({ details, status, jobId, onJobRecovered }: ReplicationSyncResultsProps) => {
  const [isRecovering, setIsRecovering] = useState(false);
  
  const isRunning = status === 'running' || status === 'pending';
  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';
  
  const vmsTotal = details?.total_vms || 0;
  const vmsSynced = details?.vms_synced || 0;
  const vmsCompleted = details?.vms_completed || 0;
  const bytesTransferred = details?.bytes_transferred || details?.total_bytes || 0;
  const progressPercent = details?.progress_percent || 0;
  const currentStep = details?.current_step || '-';
  const currentVm = details?.current_vm || details?.vm_name;
  const groupName = details?.protection_group_name || details?.group_name || 'Unknown Group';
  const errors = details?.errors || [];
  
  // Stale job detection
  const consoleLog = Array.isArray(details?.console_log) ? details.console_log : [];
  const consoleIndicatesComplete = consoleLog.some((log: string) =>
    typeof log === 'string' && log.toLowerCase().includes('sync complete')
  );
  const detailsIndicateComplete = 
    (vmsSynced > 0 && vmsSynced >= vmsTotal) ||
    (vmsCompleted > 0 && vmsCompleted >= vmsTotal);
  
  const isStale = isRunning && (consoleIndicatesComplete || detailsIndicateComplete);

  const handleForceComplete = async () => {
    if (!jobId) return;
    setIsRecovering(true);
    try {
      const result = await forceCompleteReplicationJob(jobId);
      if (result.success) {
        toast.success('Job marked as complete');
        onJobRecovered?.();
      } else {
        toast.error(`Failed to recover job: ${result.error}`);
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setIsRecovering(false);
    }
  };
  
  return (
    <div className="space-y-4">
      {/* Stale Job Warning */}
      {isStale && jobId && (
        <Alert className="border-amber-500/50 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-600">Job Appears Complete</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span className="text-sm">
              This job's data shows all VMs synced successfully, but the status wasn't updated properly.
            </span>
            <Button 
              size="sm" 
              variant="outline" 
              className="ml-4 border-amber-500/50 hover:bg-amber-500/10"
              onClick={handleForceComplete}
              disabled={isRecovering}
            >
              {isRecovering ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Recovering...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Mark Complete
                </>
              )}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-5 w-5 text-primary" />
            Replication Sync: {groupName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* VMs Synced */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">VMs Synced</p>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">{vmsSynced}</span>
                <span className="text-muted-foreground">/ {vmsTotal}</span>
              </div>
            </div>
            
            {/* Data Transferred */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Data Transferred</p>
              <p className="text-2xl font-bold">{formatBytes(bytesTransferred)}</p>
            </div>
            
            {/* Current Step */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Current Step</p>
              <p className="text-sm font-medium truncate" title={currentStep}>{currentStep}</p>
            </div>
            
            {/* Status */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Status</p>
              <Badge 
                variant={isCompleted ? "secondary" : isFailed ? "destructive" : "default"}
                className="capitalize"
              >
                {status}
              </Badge>
            </div>
          </div>
          
          {/* Progress Bar for Running Jobs */}
          {isRunning && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              {currentVm && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Server className="h-3 w-3" />
                  Currently processing: <span className="font-medium">{currentVm}</span>
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* VM Progress List */}
      {vmsTotal > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              VM Sync Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {/* Show current/last VM being processed */}
              {currentVm && (
                <div className="flex items-center justify-between p-2 rounded-md border bg-muted/30">
                  <div className="flex items-center gap-2">
                    {isRunning ? (
                      <Clock className="h-4 w-4 text-primary animate-pulse" />
                    ) : isFailed && errors.some((e: any) => e.vm === currentVm) ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    )}
                    <span className="font-medium">{currentVm}</span>
                  </div>
                  <Badge variant={isRunning ? "default" : "secondary"} className="text-xs">
                    {isRunning ? 'In Progress' : 'Processed'}
                  </Badge>
                </div>
              )}
              
              {/* Summary of VMs processed */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                <ArrowRight className="h-3 w-3" />
                <span>
                  {vmsCompleted} of {vmsTotal} VMs processed
                  {errors.length > 0 && `, ${errors.length} with errors`}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Errors Card */}
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Sync Errors ({errors.length})</AlertTitle>
          <AlertDescription>
            <div className="mt-2 space-y-2">
              {errors.map((err: any, idx: number) => (
                <div key={idx} className="p-2 bg-destructive/10 rounded border border-destructive/20">
                  <div className="flex items-center gap-2">
                    <Server className="h-3 w-3" />
                    <span className="font-medium">{err.vm}</span>
                  </div>
                  <p className="text-sm font-mono mt-1 text-destructive/80">{err.error}</p>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}
      
      {/* Success Message */}
      {isCompleted && errors.length === 0 && (
        <Alert className="border-success/50 bg-success/5">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertTitle className="text-success">Sync Completed Successfully</AlertTitle>
          <AlertDescription>
            All {vmsSynced} VMs have been synchronized to the replication target.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};
