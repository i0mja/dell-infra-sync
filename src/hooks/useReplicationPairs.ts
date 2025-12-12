/**
 * Replication Pairs Hook
 * 
 * Manages replication pairs (source <-> destination ZFS/vCenter connections)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ReplicationPair {
  id: string;
  name: string;
  description?: string;
  source_vcenter_id?: string;
  destination_vcenter_id?: string;
  source_target_id?: string;
  destination_target_id?: string;
  source_dataset?: string;
  destination_dataset?: string;
  replication_method?: 'zfs_send' | 'rsync' | 'vaai';
  use_compression: boolean;
  use_encryption: boolean;
  is_enabled: boolean;
  connection_status?: 'healthy' | 'degraded' | 'failed' | 'unknown';
  last_connection_test?: string;
  last_connection_error?: string;
  bytes_transferred_total: number;
  created_at: string;
  updated_at?: string;
  // Joined data
  source_vcenter_name?: string;
  destination_vcenter_name?: string;
  source_target_name?: string;
  destination_target_name?: string;
}

export function useReplicationPairs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: pairs = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['replication-pairs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('replication_pairs')
        .select(`
          *,
          source_vcenter:source_vcenter_id(id, name, host),
          destination_vcenter:destination_vcenter_id(id, name, host),
          source_target:source_target_id(id, name, hostname),
          destination_target:destination_target_id(id, name, hostname)
        `)
        .order('name');
      if (error) throw error;
      
      // Flatten joined data
      return (data || []).map(row => ({
        ...row,
        source_vcenter_name: (row.source_vcenter as { name?: string } | null)?.name,
        destination_vcenter_name: (row.destination_vcenter as { name?: string } | null)?.name,
        source_target_name: (row.source_target as { name?: string } | null)?.name,
        destination_target_name: (row.destination_target as { name?: string } | null)?.name,
      })) as ReplicationPair[];
    }
  });

  const createPairMutation = useMutation({
    mutationFn: async (pair: Partial<ReplicationPair>) => {
      const { data, error } = await supabase
        .from('replication_pairs')
        .insert({
          name: pair.name,
          description: pair.description,
          source_vcenter_id: pair.source_vcenter_id,
          destination_vcenter_id: pair.destination_vcenter_id,
          source_target_id: pair.source_target_id,
          destination_target_id: pair.destination_target_id,
          source_dataset: pair.source_dataset,
          destination_dataset: pair.destination_dataset,
          replication_method: pair.replication_method || 'zfs_send',
          use_compression: pair.use_compression ?? true,
          use_encryption: pair.use_encryption ?? true,
          is_enabled: pair.is_enabled ?? true,
          connection_status: 'unknown',
        })
        .select()
        .single();
      if (error) throw error;
      return data as ReplicationPair;
    },
    onSuccess: () => {
      toast({ title: 'Replication pair created' });
      queryClient.invalidateQueries({ queryKey: ['replication-pairs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const updatePairMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ReplicationPair> }) => {
      const { data, error } = await supabase
        .from('replication_pairs')
        .update({
          name: updates.name,
          description: updates.description,
          source_dataset: updates.source_dataset,
          destination_dataset: updates.destination_dataset,
          replication_method: updates.replication_method,
          use_compression: updates.use_compression,
          use_encryption: updates.use_encryption,
          is_enabled: updates.is_enabled,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as ReplicationPair;
    },
    onSuccess: () => {
      toast({ title: 'Replication pair updated' });
      queryClient.invalidateQueries({ queryKey: ['replication-pairs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const deletePairMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('replication_pairs')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Replication pair deleted' });
      queryClient.invalidateQueries({ queryKey: ['replication-pairs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (id: string) => {
      // Get current user
      const { data: userData } = await supabase.auth.getUser();
      
      // Create a test_replication_pair job that the Job Executor will process
      const { data, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'test_replication_pair' as any,
          status: 'pending',
          created_by: userData?.user?.id,
          details: { pair_id: id }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Also update the pair to show testing is in progress
      await supabase
        .from('replication_pairs')
        .update({
          connection_status: 'unknown',
          last_connection_test: new Date().toISOString(),
        })
        .eq('id', id);
      
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Connection test started', description: 'Check Jobs page for progress' });
      queryClient.invalidateQueries({ queryKey: ['replication-pairs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  return {
    pairs,
    loading,
    error: error?.message || null,
    refetch,
    createPair: createPairMutation.mutateAsync,
    updatePair: updatePairMutation.mutateAsync,
    deletePair: deletePairMutation.mutateAsync,
    testConnection: testConnectionMutation.mutateAsync,
    isTestingConnection: testConnectionMutation.isPending,
  };
}

export function useFailoverEvents(protectionGroupId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: events = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['failover-events', protectionGroupId],
    queryFn: async () => {
      let query = supabase
        .from('failover_events')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (protectionGroupId) {
        query = query.eq('protection_group_id', protectionGroupId);
      }
      
      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data;
    }
  });

  const createFailoverEventMutation = useMutation({
    mutationFn: async (event: {
      protection_group_id: string;
      failover_type: 'test' | 'planned' | 'unplanned';
      test_network_id?: string;
      shutdown_source_vms?: 'immediate' | 'graceful' | 'none';
      reverse_protection?: boolean;
      commit_policy?: 'auto' | 'manual';
      commit_delay_minutes?: number;
    }) => {
      const { data, error } = await supabase
        .from('failover_events')
        .insert({
          protection_group_id: event.protection_group_id,
          failover_type: event.failover_type,
          test_network_id: event.test_network_id,
          shutdown_source_vms: event.shutdown_source_vms || 'graceful',
          reverse_protection: event.reverse_protection ?? false,
          commit_policy: event.commit_policy || 'manual',
          commit_delay_minutes: event.commit_delay_minutes || 60,
          status: 'pending',
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Failover initiated' });
      queryClient.invalidateQueries({ queryKey: ['failover-events'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  return {
    events,
    loading,
    error: error?.message || null,
    refetch,
    createFailoverEvent: createFailoverEventMutation.mutateAsync,
  };
}
