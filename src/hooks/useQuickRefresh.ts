/**
 * useQuickRefresh Hook
 * 
 * Triggers a quick background sync of VMs/datastores when wizards open,
 * ensuring data is fresh without blocking the UI.
 * 
 * Now uses instant API when available for faster responses.
 */

import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { triggerPartialSync } from "@/services/vcenterService";

type RefreshScope = 'vms' | 'datastores' | 'hosts' | 'clusters' | 'networks';

interface QuickRefreshState {
  isRefreshing: boolean;
  refreshingScopes: RefreshScope[];
  lastRefresh: Date | null;
}

export function useQuickRefresh(vcenterId: string | null) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<QuickRefreshState>({
    isRefreshing: false,
    refreshingScopes: [],
    lastRefresh: null,
  });
  
  const activeJobIds = useRef<Map<string, string>>(new Map());
  
  const invalidateQueriesForScopes = useCallback((scopes: RefreshScope[]) => {
    if (scopes.includes('vms')) {
      queryClient.invalidateQueries({ queryKey: ['vcenter-vms'] });
    }
    if (scopes.includes('datastores')) {
      queryClient.invalidateQueries({ queryKey: ['accessible-datastores'] });
      queryClient.invalidateQueries({ queryKey: ['vcenter-datastores'] });
    }
    if (scopes.includes('hosts')) {
      queryClient.invalidateQueries({ queryKey: ['vcenter-hosts'] });
    }
    if (scopes.includes('clusters')) {
      queryClient.invalidateQueries({ queryKey: ['vcenter-clusters'] });
    }
    if (scopes.includes('networks')) {
      queryClient.invalidateQueries({ queryKey: ['vcenter-networks'] });
    }
  }, [queryClient]);
  
  const triggerQuickRefresh = useCallback(async (scopes: RefreshScope[]) => {
    if (!vcenterId || state.isRefreshing) return;
    
    setState(prev => ({
      ...prev,
      isRefreshing: true,
      refreshingScopes: scopes,
    }));
    
    try {
      // Use instant API for all scopes in parallel
      const results = await Promise.allSettled(
        scopes.map(async (scope) => {
          const result = await triggerPartialSync(scope, vcenterId);
          
          // If result is a string, it's a job ID (fallback occurred)
          if (typeof result === 'string') {
            activeJobIds.current.set(scope, result);
            return { scope, jobId: result, instant: false };
          }
          
          // Instant API succeeded
          return { scope, instant: true, success: result.success };
        })
      );
      
      // Check if any fell back to job queue
      const jobFallbacks = results
        .filter((r): r is PromiseFulfilledResult<{ scope: RefreshScope; jobId: string; instant: false }> => 
          r.status === 'fulfilled' && !r.value.instant
        )
        .map(r => r.value);
      
      if (jobFallbacks.length === 0) {
        // All instant - immediately invalidate and complete
        invalidateQueriesForScopes(scopes);
        setState({
          isRefreshing: false,
          refreshingScopes: [],
          lastRefresh: new Date(),
        });
        return;
      }
      
      // Some fell back to job queue - need to poll for completion
      // Import supabase only when needed for polling
      const { supabase } = await import("@/integrations/supabase/client");
      
      const pollInterval = setInterval(async () => {
        let allComplete = true;
        
        for (const { scope, jobId } of jobFallbacks) {
          const { data: job } = await supabase
            .from("jobs")
            .select("status")
            .eq("id", jobId)
            .single();
          
          if (job?.status === 'completed' || job?.status === 'failed') {
            activeJobIds.current.delete(scope);
          } else {
            allComplete = false;
          }
        }
        
        if (allComplete) {
          clearInterval(pollInterval);
          invalidateQueriesForScopes(scopes);
          setState({
            isRefreshing: false,
            refreshingScopes: [],
            lastRefresh: new Date(),
          });
        }
      }, 2000);
      
      // Timeout after 60 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (state.isRefreshing) {
          setState(prev => ({
            ...prev,
            isRefreshing: false,
            refreshingScopes: [],
          }));
        }
      }, 60000);
      
    } catch (err) {
      console.error('Quick refresh failed:', err);
      setState(prev => ({
        ...prev,
        isRefreshing: false,
        refreshingScopes: [],
      }));
    }
  }, [vcenterId, state.isRefreshing, invalidateQueriesForScopes]);
  
  const refreshSingle = useCallback(async (scope: RefreshScope) => {
    if (!vcenterId) return;
    
    setState(prev => ({
      ...prev,
      isRefreshing: true,
      refreshingScopes: [scope],
    }));
    
    try {
      const result = await triggerPartialSync(scope, vcenterId);
      
      // If result is NOT a string, instant API succeeded
      if (typeof result !== 'string') {
        invalidateQueriesForScopes([scope]);
        setState({
          isRefreshing: false,
          refreshingScopes: [],
          lastRefresh: new Date(),
        });
        return;
      }
      
      // Fallback to job queue - poll for completion
      const { supabase } = await import("@/integrations/supabase/client");
      
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const { data: jobResult } = await supabase
          .from("jobs")
          .select("status")
          .eq("id", result)
          .single();
        
        if (jobResult?.status === 'completed' || jobResult?.status === 'failed' || attempts >= 30) {
          clearInterval(pollInterval);
          invalidateQueriesForScopes([scope]);
          setState({
            isRefreshing: false,
            refreshingScopes: [],
            lastRefresh: new Date(),
          });
        }
      }, 2000);
      
    } catch (err) {
      console.error(`Failed to refresh ${scope}:`, err);
      setState(prev => ({
        ...prev,
        isRefreshing: false,
        refreshingScopes: [],
      }));
    }
  }, [vcenterId, invalidateQueriesForScopes]);
  
  return {
    isRefreshing: state.isRefreshing,
    refreshingScopes: state.refreshingScopes,
    lastRefresh: state.lastRefresh,
    triggerQuickRefresh,
    refreshSingle,
    isRefreshingScope: (scope: RefreshScope) => state.refreshingScopes.includes(scope),
  };
}
