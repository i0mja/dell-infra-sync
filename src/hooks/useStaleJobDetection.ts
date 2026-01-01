import { useMemo } from "react";

export interface StaleJobInfo {
  isStale: boolean;
  staleReason: string | null;
  suggestedAction: 'force_complete' | 'force_fail' | 'cancel' | null;
  derivedProgress: number | null;
  tasksComplete: boolean;
  consoleIndicatesComplete: boolean;
  runningMinutes: number;
}

interface Job {
  id: string;
  job_type: string;
  status: string;
  started_at: string | null;
  details: any;
}

interface JobTask {
  id: string;
  status: string;
  progress?: number;
}

/**
 * Hook to detect stale jobs - jobs that appear complete but status wasn't updated.
 * Primarily designed for replication sync jobs but works for other job types.
 */
export function useStaleJobDetection(
  job: Job | null,
  tasks: JobTask[] = [],
  consoleLog: string[] = []
): StaleJobInfo {
  return useMemo(() => {
    const defaultResult: StaleJobInfo = {
      isStale: false,
      staleReason: null,
      suggestedAction: null,
      derivedProgress: null,
      tasksComplete: false,
      consoleIndicatesComplete: false,
      runningMinutes: 0,
    };

    if (!job || job.status !== 'running') {
      return defaultResult;
    }

    // Calculate running time
    const runningMinutes = job.started_at
      ? Math.floor((Date.now() - new Date(job.started_at).getTime()) / 60000)
      : 0;

    // Check if all tasks are complete
    const tasksComplete = tasks.length > 0 && tasks.every(t => t.status === 'completed');

    // Check console log for completion indicators
    const consoleArray = Array.isArray(consoleLog) ? consoleLog : 
      (Array.isArray(job.details?.console_log) ? job.details.console_log : []);
    
    const completionPatterns = [
      'Sync complete',
      'All VMs synced',
      'Replication completed',
      'Successfully synced',
      'vms_synced',
      'Transfer complete',
    ];
    
    const consoleIndicatesComplete = consoleArray.some((log: string) =>
      completionPatterns.some(pattern => 
        typeof log === 'string' && log.toLowerCase().includes(pattern.toLowerCase())
      )
    );

    // Check job.details for completion indicators
    const details = job.details || {};
    const detailsIndicateComplete = 
      (details.vms_synced > 0 && details.vms_synced >= (details.total_vms || 1)) ||
      (details.vms_completed > 0 && details.vms_completed >= (details.total_vms || 1));

    // Determine if job is stale
    let isStale = false;
    let staleReason: string | null = null;
    let suggestedAction: StaleJobInfo['suggestedAction'] = null;
    let derivedProgress: number | null = null;

    // Stale detection for replication sync jobs
    if (job.job_type === 'run_replication_sync') {
      if (tasksComplete && runningMinutes > 5) {
        isStale = true;
        staleReason = `All ${tasks.length} job tasks completed but job status is still running (${runningMinutes}m)`;
        suggestedAction = 'force_complete';
        derivedProgress = 100;
      } else if (consoleIndicatesComplete && runningMinutes > 5) {
        isStale = true;
        staleReason = `Console logs indicate sync is complete but job status wasn't updated`;
        suggestedAction = 'force_complete';
        derivedProgress = 100;
      } else if (detailsIndicateComplete && runningMinutes > 5) {
        isStale = true;
        staleReason = `All VMs synced (${details.vms_synced || details.vms_completed}/${details.total_vms}) but job status wasn't updated`;
        suggestedAction = 'force_complete';
        derivedProgress = 100;
      }
    }

    // Generic stale detection for other job types
    else if (runningMinutes > 30 && tasksComplete) {
      isStale = true;
      staleReason = `Job has been running for ${runningMinutes} minutes with all tasks complete`;
      suggestedAction = 'force_complete';
      derivedProgress = 100;
    }

    return {
      isStale,
      staleReason,
      suggestedAction,
      derivedProgress,
      tasksComplete,
      consoleIndicatesComplete,
      runningMinutes,
    };
  }, [job, tasks, consoleLog]);
}

/**
 * Simple function to check if a job appears stale without React hooks
 */
export function isJobStale(
  job: { job_type: string; status: string; started_at: string | null; details: any },
  tasks: { status: string }[] = []
): boolean {
  if (job.status !== 'running') return false;
  
  const runningMinutes = job.started_at
    ? Math.floor((Date.now() - new Date(job.started_at).getTime()) / 60000)
    : 0;

  if (runningMinutes < 5) return false;

  const tasksComplete = tasks.length > 0 && tasks.every(t => t.status === 'completed');
  const details = job.details || {};
  const detailsIndicateComplete = 
    (details.vms_synced > 0 && details.vms_synced >= (details.total_vms || 1)) ||
    (details.vms_completed > 0 && details.vms_completed >= (details.total_vms || 1));

  const consoleLog = Array.isArray(details.console_log) ? details.console_log : [];
  const consoleComplete = consoleLog.some((log: string) => 
    typeof log === 'string' && log.toLowerCase().includes('sync complete')
  );

  return tasksComplete || detailsIndicateComplete || consoleComplete;
}
