import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Database, CheckCircle2, XCircle, HardDrive, ArrowRight, AlertCircle, Server, Clock } from "lucide-react";

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

export const ReplicationSyncResults = ({ details, status }: ReplicationSyncResultsProps) => {
  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';
  const isRunning = status === 'running' || status === 'pending';
  
  const vmsTotal = details?.total_vms || 0;
  const vmsSynced = details?.vms_synced || 0;
  const vmsCompleted = details?.vms_completed || 0;
  const bytesTransferred = details?.bytes_transferred || details?.total_bytes || 0;
  const currentStep = details?.current_step || '-';
  const currentVm = details?.current_vm || details?.vm_name;
  const groupName = details?.protection_group_name || details?.group_name || 'Unknown Group';
  const errors = details?.errors || [];
  
  // Detect auto-recovered jobs
  const isAutoRecovered = 
    currentStep?.toLowerCase().includes('auto-recovered') || 
    !!details?.recovery_reason;

  return (
    <div className="space-y-4">
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
              {isAutoRecovered ? (
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-medium text-amber-600 dark:text-amber-500">Unknown</span>
                  <span className="text-muted-foreground text-sm">/ {vmsTotal}</span>
                </div>
              ) : (
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold">{vmsSynced}</span>
                  <span className="text-muted-foreground">/ {vmsTotal}</span>
                </div>
              )}
            </div>
            
            {/* Data Transferred */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Data Transferred</p>
              {isAutoRecovered ? (
                <p className="text-lg font-medium text-amber-600 dark:text-amber-500">Unknown</p>
              ) : (
                <p className="text-2xl font-bold">{formatBytes(bytesTransferred)}</p>
              )}
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
        </CardContent>
      </Card>
      
      {/* Auto-Recovery Warning */}
      {isAutoRecovered && isCompleted && (
        <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          <AlertTitle className="text-amber-700 dark:text-amber-400">
            Job Auto-Recovered
          </AlertTitle>
          <AlertDescription className="text-amber-600 dark:text-amber-400">
            This job was automatically marked complete because the final status update failed to arrive. 
            The replication sync likely completed successfully, but the exact VM count and bytes transferred are unknown.
            Check the target storage to verify all VMs were synchronized.
          </AlertDescription>
        </Alert>
      )}
      
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
                      <Database className="h-4 w-4 text-primary animate-pulse" />
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
      {isCompleted && errors.length === 0 && !isAutoRecovered && (
        <Alert className="border-success/50 bg-success/5">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertTitle className="text-success">Sync Completed Successfully</AlertTitle>
          <AlertDescription>
            All {vmsSynced} VMs have been synchronized to the replication target.
          </AlertDescription>
        </Alert>
      )}
      
      {isCompleted && errors.length === 0 && isAutoRecovered && (
        <Alert className="border-success/50 bg-success/5">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertTitle className="text-success">Sync Likely Completed</AlertTitle>
          <AlertDescription>
            The replication sync was auto-recovered. Check the target storage to verify all VMs were synchronized.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};
