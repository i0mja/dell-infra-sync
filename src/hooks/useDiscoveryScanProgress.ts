import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { mapStageToPhase, type DiscoveryPhase } from '@/lib/discovery-scan-messages';

export interface ServerResult {
  ip: string;
  status: 'pending' | 'port_check' | 'detecting' | 'authenticating' | 'syncing' | 'scp' | 'synced' | 'auth_failed' | 'filtered';
  model?: string;
  serviceTag?: string;
  credentialSet?: string;
  duration?: number;
  filterReason?: string;
  scpProgress?: number;
}

export interface DiscoveryScanProgress {
  currentIp?: string;
  currentStage?: string;
  currentPhase: DiscoveryPhase;
  ipsProcessed: number;
  ipsTotal: number;
  progressPercent: number;
  
  // Stage statistics
  stage1Passed: number;  // Port open
  stage1Filtered: number;  // Port closed
  stage2Passed: number;  // iDRAC detected
  stage2Filtered: number;  // Not iDRAC
  stage3Passed: number;  // Auth success
  stage3Failed: number;  // Auth failed
  
  // Active counts (real-time)
  inPortCheck: number;
  inDetecting: number;
  inAuthenticating: number;
  inSyncing: number;
  inScp: number;
  
  // Final counts
  discovered: number;
  authFailures: number;
  scpBackups: number;
  scpCompleted: number;
  
  // Per-server results (if available)
  serverResults: ServerResult[];
  
  // Refresh info
  serversRefreshed: number;
  serversTotal: number;
  currentServer?: string;
  currentServerIp?: string;
  scpProgress?: number;
  currentStep?: string;
  
  // Orphan detection flag
  isEffectivelyComplete: boolean;
}

const defaultProgress: DiscoveryScanProgress = {
  ipsProcessed: 0,
  ipsTotal: 0,
  currentIp: '',
  currentStage: '',
  currentStep: undefined,
  currentServerIp: undefined,
  scpProgress: undefined,
  stage1Passed: 0,
  stage1Filtered: 0,
  stage2Passed: 0,
  stage2Filtered: 0,
  stage3Passed: 0,
  stage3Failed: 0,
  inPortCheck: 0,
  inDetecting: 0,
  inAuthenticating: 0,
  inSyncing: 0,
  inScp: 0,
  serversRefreshed: 0,
  serversTotal: 0,
  scpCompleted: 0,
  serverResults: [],
  progressPercent: 0,
  currentPhase: 'port_scan',
  discovered: 0,
  authFailures: 0,
  scpBackups: 0,
  isEffectivelyComplete: false,
};

export function useDiscoveryScanProgress(jobId: string | undefined, isRunning: boolean) {
  const [progress, setProgress] = useState<DiscoveryScanProgress>(defaultProgress);

  // Determine effective phase using watermark logic - phase only advances forward
  const determineEffectivePhase = (
    currentStage: string | undefined,
    serversRefreshed: number,
    scpCompleted: number
  ): DiscoveryPhase => {
    // If we've completed any SCP backups, we're in SCP phase (watermark)
    if (scpCompleted > 0) return 'scp';
    
    // If current stage is scp (even if no completions yet), show scp
    if (currentStage === 'scp') return 'scp';
    
    // If we've synced any servers, we're in sync phase  
    if (serversRefreshed > 0 || currentStage === 'sync') return 'sync';
    
    // Still in discovery - use stage mapping
    return mapStageToPhase(currentStage);
  };

  const parseJobDetails = useCallback((details: any): DiscoveryScanProgress => {
    if (!details) return defaultProgress;

    const ipsProcessed = details.ips_processed ?? 0;
    const ipsTotal = details.ips_total ?? details.scanned_ips ?? 0;
    const serversRefreshed = details.servers_refreshed ?? 0;
    const serversTotal = details.servers_total ?? 0;
    const scpCompleted = details.scp_completed ?? 0;
    const currentStage = details.current_stage;
    
    // Get stage stats - use discovered_count as fallback for stage3 since it may be set after discovery
    const stage1Passed = details.stage1_passed ?? 0;
    const stage2Passed = details.stage2_passed ?? 0;
    const stage3Passed = details.stage3_passed ?? details.discovered_count ?? 0;
    
    // If we're in sync/scp phases and have serversTotal but no stage data,
    // discovery phases completed - infer from serversTotal
    const discoveryCompleted = (currentStage === 'sync' || currentStage === 'scp') && serversTotal > 0;
    const effectiveStage3Passed = stage3Passed > 0 ? stage3Passed : (discoveryCompleted ? serversTotal : 0);
    const effectiveStage2Passed = stage2Passed > 0 ? stage2Passed : (discoveryCompleted ? serversTotal : 0);
    const effectiveStage1Passed = stage1Passed > 0 ? stage1Passed : (discoveryCompleted ? serversTotal : 0);
    
    // Use watermark logic to determine phase - prevents bouncing
    const effectivePhase = determineEffectivePhase(currentStage, serversRefreshed, scpCompleted);
    
    // Calculate progress percentage based on phase
    // Port scan/detection/auth = 50%, Sync = 30%, SCP = 20%
    let progressPercent = 0;
    
    if (discoveryCompleted) {
      // Discovery is done, calculate from sync/scp
      progressPercent = 50; // Discovery complete
      if (serversTotal > 0) {
        const syncPercent = (serversRefreshed / serversTotal) * 30;
        const scpPercent = (scpCompleted / serversTotal) * 20;
        progressPercent = 50 + syncPercent + scpPercent;
      }
    } else if (ipsTotal > 0) {
      // Still in discovery phases
      const discoveryPercent = (ipsProcessed / ipsTotal) * 50;
      progressPercent = discoveryPercent;
    }
    
    progressPercent = Math.min(Math.round(progressPercent), 100);

    // Parse server results if available
    const serverResults: ServerResult[] = (details.server_results ?? []).map((r: any) => ({
      ip: r.ip,
      status: r.status,
      model: r.model,
      serviceTag: r.service_tag,
      credentialSet: r.credential_set,
      duration: r.duration,
      filterReason: r.filter_reason,
      scpProgress: r.scp_progress,
    }));
    
    // Determine active counts based on current stage
    const inSyncing = currentStage === 'sync' ? 1 : 0;
    const inScp = currentStage === 'scp' ? 1 : 0;

    // Detect if job is effectively complete (all work done)
    const isEffectivelyComplete = 
      currentStage === 'complete' || 
      (serversTotal > 0 && 
       serversRefreshed >= serversTotal && 
       scpCompleted >= serversTotal);

    return {
      currentIp: details.current_ip,
      currentStage,
      currentPhase: effectivePhase,
      ipsProcessed,
      ipsTotal,
      progressPercent: isEffectivelyComplete ? 100 : progressPercent,
      stage1Passed: effectiveStage1Passed,
      stage1Filtered: details.stage1_filtered ?? 0,
      stage2Passed: effectiveStage2Passed,
      stage2Filtered: details.stage2_filtered ?? 0,
      stage3Passed: effectiveStage3Passed,
      stage3Failed: details.stage3_failed ?? details.auth_failures ?? 0,
      inPortCheck: details.in_port_check ?? 0,
      inDetecting: details.in_detecting ?? 0,
      inAuthenticating: details.in_authenticating ?? 0,
      inSyncing,
      inScp,
      discovered: details.discovered_count ?? details.discovered ?? serversTotal,
      authFailures: details.auth_failures ?? 0,
      scpBackups: details.scp_backups_created ?? 0,
      scpCompleted,
      serverResults,
      serversRefreshed,
      serversTotal,
      currentServer: details.current_server,
      currentServerIp: details.current_server_ip,
      scpProgress: details.scp_progress,
      currentStep: details.current_step,
      isEffectivelyComplete,
    };
  }, []);

  useEffect(() => {
    if (!jobId || !isRunning) return;

    // Initial fetch
    const fetchJob = async () => {
      const { data } = await supabase
        .from('jobs')
        .select('details')
        .eq('id', jobId)
        .single();
      
      if (data?.details) {
        setProgress(parseJobDetails(data.details));
      }
    };

    fetchJob();

    // Subscribe to job updates
    const channel = supabase
      .channel(`discovery-scan-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const details = payload.new?.details;
          if (details) {
            setProgress(parseJobDetails(details));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, isRunning, parseJobDetails]);

  return progress;
}
