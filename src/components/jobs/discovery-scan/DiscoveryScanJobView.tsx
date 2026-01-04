import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { DiscoveryScanHeader } from "./DiscoveryScanHeader";
import { DiscoveryScanLiveProgress } from "./DiscoveryScanLiveProgress";
import { DiscoveryScanServerList } from "./DiscoveryScanServerList";
import { DiscoveryScanTimeline } from "./DiscoveryScanTimeline";
import { DiscoveryScanResults } from "../results/DiscoveryScanResults";
import { useDiscoveryScanProgress } from "@/hooks/useDiscoveryScanProgress";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";

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

interface DiscoveryScanJobViewProps {
  job: Job;
}

export function DiscoveryScanJobView({ job }: DiscoveryScanJobViewProps) {
  const [isForcing, setIsForcing] = useState(false);
  const [localJobStatus, setLocalJobStatus] = useState(job.status);
  const [localCompletedAt, setLocalCompletedAt] = useState(job.completed_at);

  // Subscribe to real-time job status changes
  useEffect(() => {
    const channel = supabase
      .channel(`job-status-${job.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${job.id}`,
        },
        (payload) => {
          const newStatus = payload.new?.status;
          const newCompletedAt = payload.new?.completed_at;
          if (newStatus && newStatus !== localJobStatus) {
            setLocalJobStatus(newStatus);
          }
          if (newCompletedAt) {
            setLocalCompletedAt(newCompletedAt);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [job.id, localJobStatus]);

  // Sync local state when prop changes (e.g., dialog reopened)
  useEffect(() => {
    setLocalJobStatus(job.status);
    setLocalCompletedAt(job.completed_at);
  }, [job.status, job.completed_at]);

  // Use local status for UI decisions (real-time updates)
  const isRunning = localJobStatus === 'running' || localJobStatus === 'pending';
  const isCompleted = localJobStatus === 'completed' || localJobStatus === 'failed';
  const isCancelled = localJobStatus === 'cancelled';

  // Get real-time progress updates (including console logs)
  const progress = useDiscoveryScanProgress(job.id, isRunning || isCompleted || isCancelled);

  // Detect orphaned job: job is "running" but all work is complete
  const isOrphanedComplete = isRunning && progress.isEffectivelyComplete;

  // Use console log from realtime progress, fallback to job details for completed jobs
  const consoleLogs = progress.consoleLog.length > 0 
    ? progress.consoleLog 
    : (() => {
        const rawLog = job.details?.console_log ?? job.details?.log ?? [];
        return Array.isArray(rawLog) 
          ? rawLog 
          : typeof rawLog === 'string' 
            ? rawLog.split('\n').filter(Boolean)
            : [];
      })();

  // Parse target scope info
  const ipRanges = job.target_scope?.ip_range 
    ? [job.target_scope.ip_range]
    : job.target_scope?.ip_ranges;
  const ipList = job.target_scope?.ip_list;
  const ipCount = ipList?.length || job.details?.scanned_ips || progress.ipsTotal;

  const handleForceComplete = async () => {
    setIsForcing(true);
    try {
      const { error } = await supabase.functions.invoke('update-job', {
        body: {
          job: {
            job_id: job.id,
            status: 'completed',
            completed_at: new Date().toISOString(),
            details: {
              ...job.details,
              force_completed: true,
              force_completed_at: new Date().toISOString(),
              force_completed_reason: 'Manually completed by operator - executor failed to finalize'
            }
          }
        }
      });
      
      if (error) throw error;
      toast.success('Job marked as completed');
    } catch (err) {
      console.error('Failed to force complete job:', err);
      toast.error('Failed to complete job');
    } finally {
      setIsForcing(false);
    }
  };

  const handleForceCancel = async () => {
    setIsForcing(true);
    try {
      const { error } = await supabase.functions.invoke('update-job', {
        body: {
          job: {
            job_id: job.id,
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            details: {
              ...job.details,
              force_cancelled: true,
              force_cancelled_at: new Date().toISOString(),
              force_cancelled_reason: 'Manually cancelled by operator'
            }
          }
        }
      });
      
      if (error) throw error;
      toast.success('Job cancelled');
    } catch (err) {
      console.error('Failed to force cancel job:', err);
      toast.error('Failed to cancel job');
    } finally {
      setIsForcing(false);
    }
  };

  return (
    <ScrollArea className="h-[calc(90vh-120px)]">
      <div className="space-y-6 pr-4">
        {/* Header with status and timing */}
        <DiscoveryScanHeader
          status={localJobStatus}
          createdAt={job.created_at}
          startedAt={job.started_at}
          completedAt={localCompletedAt}
          ipRanges={ipRanges}
          ipCount={ipCount}
        />

        {/* Orphaned job warning */}
        {isOrphanedComplete && (
          <Alert variant="default" className="border-warning bg-warning/10">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle>Job appears complete but is still running</AlertTitle>
            <AlertDescription className="mt-2">
              <p className="text-sm text-muted-foreground mb-3">
                All work has finished ({progress.serversRefreshed}/{progress.serversTotal} synced, {progress.scpCompleted}/{progress.serversTotal} backed up) 
                but the executor failed to finalize the job status.
              </p>
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  onClick={handleForceComplete}
                  disabled={isForcing}
                >
                  {isForcing ? (
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-3 w-3" />
                  )}
                  Force Complete
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={handleForceCancel}
                  disabled={isForcing}
                >
                  <XCircle className="mr-2 h-3 w-3" />
                  Cancel Job
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Force cancel for stuck running jobs that aren't complete */}
        {isRunning && !isOrphanedComplete && job.started_at && (
          (() => {
            const runningMinutes = Math.floor((Date.now() - new Date(job.started_at).getTime()) / 60000);
            // Show force cancel after 10 minutes of running
            if (runningMinutes > 10) {
              return (
                <Alert variant="default" className="border-muted">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  <AlertTitle className="text-sm">Job running for {runningMinutes} minutes</AlertTitle>
                  <AlertDescription className="mt-2">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={handleForceCancel}
                      disabled={isForcing}
                    >
                      {isForcing ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : (
                        <XCircle className="mr-2 h-3 w-3" />
                      )}
                      Force Cancel
                    </Button>
                  </AlertDescription>
                </Alert>
              );
            }
            return null;
          })()
        )}

        {/* Live progress rail (only when running) */}
        {isRunning && (
          <DiscoveryScanLiveProgress
            currentPhase={progress.currentPhase}
            isRunning={isRunning && !isOrphanedComplete}
            progressPercent={progress.progressPercent}
            currentIp={progress.currentIp}
            currentStage={progress.currentStage}
            currentStep={progress.currentStep}
            currentServerIp={progress.currentServerIp}
            scpProgress={progress.scpProgress}
            stageStats={{
              stage1Passed: progress.stage1Passed,
              stage1Filtered: progress.stage1Filtered,
              stage2Passed: progress.stage2Passed,
              stage2Filtered: progress.stage2Filtered,
              stage3Passed: progress.stage3Passed,
              stage3Failed: progress.stage3Failed,
            }}
            activeCounts={{
              inPortCheck: progress.inPortCheck,
              inDetecting: progress.inDetecting,
              inAuthenticating: progress.inAuthenticating,
              inSyncing: progress.inSyncing,
              inScp: progress.inScp,
              activeServerIps: progress.activeServerIps,
            }}
            ipsProcessed={progress.ipsProcessed}
            ipsTotal={progress.ipsTotal}
            serversRefreshed={progress.serversRefreshed}
            serversTotal={progress.serversTotal}
            scpCompleted={progress.scpCompleted}
            fetchOptions={job.details?.fetch_options}
          />
        )}

        {/* Server status list (running or has results) */}
        {(isRunning || progress.serverResults.length > 0) && (
          <DiscoveryScanServerList
            serverResults={progress.serverResults}
            isRunning={isRunning}
            serversRefreshed={progress.serversRefreshed}
            serversTotal={progress.serversTotal}
            scpCompleted={progress.scpCompleted}
            currentServerIp={progress.currentServerIp}
            currentStage={progress.currentStage}
            currentStep={progress.currentStep}
            scpDisabled={job.details?.fetch_options?.scp_backup === false}
          />
        )}

        {/* Final results summary (completed only) */}
        {(isCompleted || isCancelled) && (
          <DiscoveryScanResults details={job.details} />
        )}

        {/* Activity timeline / console logs */}
        <DiscoveryScanTimeline logs={consoleLogs} />
      </div>
    </ScrollArea>
  );
}
