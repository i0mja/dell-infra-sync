/**
 * Failover Operations Hook
 * 
 * React hooks for managing failover operations including pre-flight checks,
 * test failover, live failover, commit, and rollback.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface PreflightCheckResult {
  name: string;
  passed: boolean;
  message: string;
  is_warning?: boolean;
  can_override?: boolean;
  remediation?: {
    action_type: string;
    job_type?: string;
    job_params?: Record<string, unknown>;
    description: string;
    can_auto_fix: boolean;
    requires_password?: boolean;
    requires_confirmation?: boolean;
  };
}

export interface PreflightResults {
  ready: boolean;
  checks: Record<string, PreflightCheckResult>;
  warnings: PreflightCheckResult[];
  blockers: PreflightCheckResult[];
  can_force: boolean;
}

export interface FailoverEvent {
  id: string;
  protection_group_id: string;
  failover_type: 'test' | 'live';
  status: 'pending' | 'in_progress' | 'awaiting_commit' | 'committed' | 'rolled_back' | 'failed';
  started_at?: string;
  committed_at?: string;
  rolled_back_at?: string;
  vms_recovered?: number;
  error_message?: string;
  initiated_by?: string;
  test_network_id?: string;
  shutdown_source_vms?: string;
  reverse_protection?: boolean;
  commit_policy?: string;
  commit_delay_minutes?: number;
  created_at: string;
}

export interface FailoverConfig {
  protection_group_id: string;
  failover_type: 'test' | 'live';
  shutdown_source_vms?: boolean;
  final_sync?: boolean;
  test_network_id?: string;
  reverse_protection?: boolean;
  force?: boolean;
  test_duration_minutes?: number;
}

export function useFailoverOperations(protectionGroupId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query active failover event for this group
  const { data: activeFailover, isLoading: loadingActive } = useQuery({
    queryKey: ['active-failover', protectionGroupId],
    queryFn: async () => {
      if (!protectionGroupId) return null;
      
      const { data, error } = await supabase
        .from('failover_events')
        .select('*')
        .eq('protection_group_id', protectionGroupId)
        .in('status', ['pending', 'in_progress', 'awaiting_commit'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data as FailoverEvent | null;
    },
    enabled: !!protectionGroupId,
    refetchInterval: 5000,
  });

  // Query failover history for this group
  const { data: failoverHistory = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['failover-history', protectionGroupId],
    queryFn: async () => {
      if (!protectionGroupId) return [];
      
      const { data, error } = await supabase
        .from('failover_events')
        .select('*')
        .eq('protection_group_id', protectionGroupId)
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data as FailoverEvent[];
    },
    enabled: !!protectionGroupId,
  });

  // Run pre-flight check mutation
  const runPreflightCheck = useMutation({
    mutationFn: async (groupId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'failover_preflight_check' as any,
          status: 'pending',
          created_by: user?.id,
          details: { protection_group_id: groupId }
        })
        .select()
        .single();
      
      if (error) throw error;
      return job;
    },
    onSuccess: () => {
      toast({ title: 'Pre-flight check started', description: 'Running safety checks...' });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Execute failover mutation
  const executeFailover = useMutation({
    mutationFn: async (config: FailoverConfig) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const jobType = config.failover_type === 'test' ? 'test_failover' : 'group_failover';
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: jobType as any,
          status: 'pending',
          created_by: user?.id,
          details: {
            protection_group_id: config.protection_group_id,
            failover_type: config.failover_type,
            shutdown_source_vms: config.shutdown_source_vms ?? false,
            final_sync: config.final_sync ?? true,
            test_network_id: config.test_network_id,
            reverse_protection: config.reverse_protection ?? false,
            force: config.force ?? false,
            test_duration_minutes: config.test_duration_minutes,
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      return job;
    },
    onSuccess: (_, config) => {
      const type = config.failover_type === 'test' ? 'Test failover' : 'Live failover';
      toast({ title: `${type} started`, description: 'Check job progress for updates' });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['active-failover', config.protection_group_id] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Commit failover mutation
  const commitFailover = useMutation({
    mutationFn: async (eventId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'commit_failover' as any,
          status: 'pending',
          created_by: user?.id,
          details: { failover_event_id: eventId }
        })
        .select()
        .single();
      
      if (error) throw error;
      return job;
    },
    onSuccess: () => {
      toast({ title: 'Commit initiated', description: 'Finalizing failover...' });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['active-failover'] });
      queryClient.invalidateQueries({ queryKey: ['failover-history'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Rollback failover mutation
  const rollbackFailover = useMutation({
    mutationFn: async ({ eventId, protectionGroupId }: { eventId: string; protectionGroupId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'rollback_failover' as any,
          status: 'pending',
          created_by: user?.id,
          details: { 
            event_id: eventId,
            protection_group_id: protectionGroupId
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      return job;
    },
    onSuccess: () => {
      toast({ title: 'Rollback initiated', description: 'Reverting failover...' });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['active-failover'] });
      queryClient.invalidateQueries({ queryKey: ['failover-history'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  return {
    activeFailover,
    failoverHistory,
    loadingActive,
    loadingHistory,
    runPreflightCheck,
    executeFailover,
    commitFailover,
    rollbackFailover,
  };
}

// Hook to poll job status for pre-flight checks
export function usePreflightJobStatus(jobId?: string) {
  return useQuery({
    queryKey: ['preflight-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        return false;
      }
      return 2000;
    },
  });
}
