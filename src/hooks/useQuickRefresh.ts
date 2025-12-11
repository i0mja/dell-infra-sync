/**
 * useQuickRefresh Hook
 * 
 * Triggers a quick background sync of VMs/datastores when wizards open,
 * ensuring data is fresh without blocking the UI.
 */

import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  
  const triggerQuickRefresh = useCallback(async (scopes: RefreshScope[]) => {
    if (!vcenterId || state.isRefreshing) return;
    
    setState(prev => ({
      ...prev,
      isRefreshing: true,
      refreshingScopes: scopes,
    }));
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      // Create partial sync jobs for each scope
      const jobPromises = scopes.map(async (scope) => {
        const { data: job, error } = await supabase.from("jobs").insert({
          job_type: "partial_vcenter_sync" as const,
          status: "pending" as const,
          created_by: user?.user?.id,
          details: { 
            sync_scope: scope, 
            vcenter_id: vcenterId,
            quick_refresh: true,
          },
        }).select().single();
        
        if (error) {
          console.error(`Failed to create ${scope} sync job:`, error);
          return null;
        }
        
        activeJobIds.current.set(scope, job.id);
        return { scope, jobId: job.id };
      });
      
      const jobs = await Promise.all(jobPromises);
      const validJobs = jobs.filter(Boolean) as { scope: RefreshScope; jobId: string }[];
      
      if (validJobs.length === 0) {
        setState(prev => ({ ...prev, isRefreshing: false, refreshingScopes: [] }));
        return;
      }
      
      // Poll for job completion
      const pollInterval = setInterval(async () => {
        let allComplete = true;
        
        for (const { scope, jobId } of validJobs) {
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
          
          // Invalidate queries based on scopes
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
  }, [vcenterId, state.isRefreshing, queryClient]);
  
  const refreshSingle = useCallback(async (scope: RefreshScope) => {
    if (!vcenterId) return;
    
    setState(prev => ({
      ...prev,
      isRefreshing: true,
      refreshingScopes: [scope],
    }));
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase.from("jobs").insert({
        job_type: "partial_vcenter_sync" as const,
        status: "pending" as const,
        created_by: user?.user?.id,
        details: { 
          sync_scope: scope, 
          vcenter_id: vcenterId,
          quick_refresh: true,
        },
      }).select().single();
      
      if (error) throw error;
      
      // Poll for completion
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const { data: jobResult } = await supabase
          .from("jobs")
          .select("status")
          .eq("id", job.id)
          .single();
        
        if (jobResult?.status === 'completed' || jobResult?.status === 'failed' || attempts >= 30) {
          clearInterval(pollInterval);
          
          // Invalidate relevant queries
          if (scope === 'vms') {
            queryClient.invalidateQueries({ queryKey: ['vcenter-vms'] });
          } else if (scope === 'datastores') {
            queryClient.invalidateQueries({ queryKey: ['accessible-datastores'] });
            queryClient.invalidateQueries({ queryKey: ['vcenter-datastores'] });
          } else if (scope === 'hosts') {
            queryClient.invalidateQueries({ queryKey: ['vcenter-hosts'] });
          } else if (scope === 'clusters') {
            queryClient.invalidateQueries({ queryKey: ['vcenter-clusters'] });
          } else if (scope === 'networks') {
            queryClient.invalidateQueries({ queryKey: ['vcenter-networks'] });
          }
          
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
  }, [vcenterId, queryClient]);
  
  return {
    isRefreshing: state.isRefreshing,
    refreshingScopes: state.refreshingScopes,
    lastRefresh: state.lastRefresh,
    triggerQuickRefresh,
    refreshSingle,
    isRefreshingScope: (scope: RefreshScope) => state.refreshingScopes.includes(scope),
  };
}
