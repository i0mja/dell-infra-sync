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
}

const defaultProgress: DiscoveryScanProgress = {
  currentPhase: 'port_scan',
  ipsProcessed: 0,
  ipsTotal: 0,
  progressPercent: 0,
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
  discovered: 0,
  authFailures: 0,
  scpBackups: 0,
  scpCompleted: 0,
  serverResults: [],
  serversRefreshed: 0,
  serversTotal: 0,
};

export function useDiscoveryScanProgress(jobId: string | undefined, isRunning: boolean) {
  const [progress, setProgress] = useState<DiscoveryScanProgress>(defaultProgress);

  const parseJobDetails = useCallback((details: any): DiscoveryScanProgress => {
    if (!details) return defaultProgress;

    const ipsProcessed = details.ips_processed ?? 0;
    const ipsTotal = details.ips_total ?? details.scanned_ips ?? 0;
    const serversRefreshed = details.servers_refreshed ?? 0;
    const serversTotal = details.servers_total ?? 0;
    const scpCompleted = details.scp_completed ?? 0;
    const currentStage = details.current_stage;
    
    // Calculate progress percentage based on phase
    // Port scan/detection/auth = 50%, Sync = 30%, SCP = 20%
    let progressPercent = 0;
    if (ipsTotal > 0) {
      // Discovery phases (port scan, detection, auth) = 50%
      const discoveryPercent = (ipsProcessed / ipsTotal) * 50;
      progressPercent = discoveryPercent;
    }
    
    if (serversTotal > 0) {
      // Sync phase = 30% 
      const syncPercent = (serversRefreshed / serversTotal) * 30;
      // SCP phase = 20%
      const scpPercent = (scpCompleted / serversTotal) * 20;
      progressPercent = 50 + syncPercent + scpPercent;
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

    return {
      currentIp: details.current_ip,
      currentStage,
      currentPhase: mapStageToPhase(currentStage),
      ipsProcessed,
      ipsTotal,
      progressPercent,
      stage1Passed: details.stage1_passed ?? 0,
      stage1Filtered: details.stage1_filtered ?? 0,
      stage2Passed: details.stage2_passed ?? 0,
      stage2Filtered: details.stage2_filtered ?? 0,
      stage3Passed: details.stage3_passed ?? details.discovered_count ?? 0,
      stage3Failed: details.stage3_failed ?? details.auth_failures ?? 0,
      inPortCheck: details.in_port_check ?? 0,
      inDetecting: details.in_detecting ?? 0,
      inAuthenticating: details.in_authenticating ?? 0,
      inSyncing,
      inScp,
      discovered: details.discovered_count ?? details.discovered ?? 0,
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
