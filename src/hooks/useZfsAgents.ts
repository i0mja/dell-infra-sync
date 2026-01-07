/**
 * Hook for managing ZFS agents.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ZfsAgent {
  id: string;
  target_id: string | null;
  hostname: string;
  agent_version: string | null;
  api_url: string | null;
  api_port: number;
  api_protocol: string;
  last_seen_at: string | null;
  capabilities: Record<string, unknown>;
  status: 'online' | 'idle' | 'busy' | 'offline' | 'unknown';
  pool_name: string | null;
  pool_size_bytes: number | null;
  pool_free_bytes: number | null;
  pool_health: string | null;
  created_at: string;
  updated_at: string;
}

export function useZfsAgents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: agents = [], isLoading, error, refetch } = useQuery({
    queryKey: ['zfs-agents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zfs_agents')
        .select('*')
        .order('hostname');
      if (error) throw error;
      return data as ZfsAgent[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Mark stale agents as offline
  const markStaleMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('mark_stale_agents_offline');
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      if (count > 0) {
        queryClient.invalidateQueries({ queryKey: ['zfs-agents'] });
      }
    }
  });

  // Get agent for a specific target
  const getAgentForTarget = (targetId: string): ZfsAgent | undefined => {
    return agents.find(a => a.target_id === targetId);
  };

  // Check if agent is online
  const isAgentOnline = (agent: ZfsAgent): boolean => {
    return ['online', 'idle', 'busy'].includes(agent.status);
  };

  // Get agents that are not linked to any target
  const getUnlinkedAgents = (): ZfsAgent[] => {
    return agents.filter(a => !a.target_id);
  };

  // Get online agents that are not linked to any target
  const getAvailableAgents = (): ZfsAgent[] => {
    return agents.filter(a => !a.target_id && isAgentOnline(a));
  };

  return {
    agents,
    isLoading,
    error: error?.message || null,
    refetch,
    markStaleAgents: markStaleMutation.mutateAsync,
    getAgentForTarget,
    isAgentOnline,
    getUnlinkedAgents,
    getAvailableAgents,
    onlineCount: agents.filter(isAgentOnline).length,
    totalCount: agents.length
  };
}
