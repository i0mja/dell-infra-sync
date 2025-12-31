import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

/**
 * Dedicated hook for vCenter sync job progress monitoring.
 * 
 * Unlike the generic useJobProgress, this hook:
 * - Only subscribes to the jobs table (no job_tasks or workflow_executions)
 * - Calculates progress from sync_phase and current_vcenter_index
 * - Provides phase-based progress tracking
 */

export interface VCenterSyncDetails {
  sync_phase?: number;
  current_step?: string;
  total_vcenters?: number;
  current_vcenter_index?: number;
  current_vcenter_name?: string;
  vcenter_name?: string;
  vcenter_host?: string;
  clusters_synced?: number;
  hosts_synced?: number;
  datastores_synced?: number;
  networks_synced?: number;
  vms_synced?: number;
  alarms_synced?: number;
  console_log?: string[];
}

export interface VCenterSyncProgress {
  progressPercent: number;
  currentStep?: string;
  syncPhase: number;
  totalVcenters: number;
  currentVcenterIndex: number;
  currentVcenterName?: string;
  details: VCenterSyncDetails | null;
  elapsedMs?: number;
}

// Total number of phases in the sync process
const TOTAL_SYNC_PHASES = 10;

/**
 * Calculate progress percentage from sync_phase and vCenter index
 */
function calculateProgress(details: VCenterSyncDetails | null): number {
  if (!details) return 0;
  
  const syncPhase = details.sync_phase ?? 0;
  const totalVcenters = details.total_vcenters ?? 1;
  const currentVcenterIndex = details.current_vcenter_index ?? 0;
  
  // Progress per vCenter = (phase / total_phases) * 100
  const phaseProgress = (syncPhase / TOTAL_SYNC_PHASES) * 100;
  
  // Overall progress across multiple vCenters
  // Each vCenter contributes (100 / totalVcenters) to overall progress
  const perVcenterWeight = 100 / totalVcenters;
  const completedVcentersProgress = currentVcenterIndex * perVcenterWeight;
  const currentVcenterProgress = (phaseProgress / 100) * perVcenterWeight;
  
  return Math.min(100, Math.round(completedVcentersProgress + currentVcenterProgress));
}

export function useVCenterSyncProgress(jobId: string | null, enabled: boolean = true, jobStatus?: string) {
  // Reduce polling for non-running jobs
  const pollingInterval = jobStatus === 'running' ? 2000 : 10000;
  
  const query = useQuery({
    queryKey: ['vcenter-sync-progress', jobId],
    queryFn: async (): Promise<VCenterSyncProgress | null> => {
      if (!jobId) return null;
      
      // Only fetch from jobs table - no job_tasks or workflow_executions needed
      const { data: job, error } = await supabase
        .from('jobs')
        .select('details, started_at')
        .eq('id', jobId)
        .single();
      
      if (error) throw error;
      
      const details = (job?.details as unknown) as VCenterSyncDetails | null;
      
      // Calculate elapsed time
      let elapsedMs: number | undefined;
      if (job?.started_at) {
        elapsedMs = Date.now() - new Date(job.started_at).getTime();
      }
      
      return {
        progressPercent: calculateProgress(details),
        currentStep: details?.current_step,
        syncPhase: details?.sync_phase ?? 0,
        totalVcenters: details?.total_vcenters ?? 1,
        currentVcenterIndex: details?.current_vcenter_index ?? 0,
        currentVcenterName: details?.current_vcenter_name || details?.vcenter_name || details?.vcenter_host,
        details,
        elapsedMs,
      };
    },
    enabled: enabled && !!jobId,
    refetchInterval: pollingInterval,
  });
  
  // Subscribe to real-time updates on jobs table only
  useEffect(() => {
    if (!jobId || !enabled) return;
    
    const channel = supabase
      .channel(`vcenter-sync-progress-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${jobId}`
        },
        () => {
          query.refetch();
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, enabled]);
  
  return query;
}
