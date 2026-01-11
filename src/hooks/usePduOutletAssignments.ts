import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface OutletAssignment {
  mapping_id: string;
  server_id: string;
  server_hostname: string;
  server_ip: string;
  feed_label: 'A' | 'B';
  notes?: string;
}

export function usePduOutletAssignments(pduId: string | null) {
  const queryClient = useQueryClient();

  const { data: assignments = {}, isLoading, refetch } = useQuery({
    queryKey: ['pdu-outlet-assignments', pduId],
    queryFn: async () => {
      if (!pduId) return {};
      
      const { data, error } = await supabase
        .from('server_pdu_mappings')
        .select(`
          id,
          server_id,
          outlet_number,
          feed_label,
          notes,
          server:servers(hostname, ip_address)
        `)
        .eq('pdu_id', pduId);
      
      if (error) throw error;
      
      // Create a map of outlet_number to assignment info
      const assignmentMap: Record<number, OutletAssignment> = {};
      (data || []).forEach((mapping) => {
        const server = mapping.server as unknown as { hostname: string; ip_address: string } | null;
        assignmentMap[mapping.outlet_number] = {
          mapping_id: mapping.id,
          server_id: mapping.server_id,
          server_hostname: server?.hostname || 'Unknown',
          server_ip: server?.ip_address || '',
          feed_label: mapping.feed_label as 'A' | 'B',
          notes: mapping.notes || undefined,
        };
      });
      
      return assignmentMap;
    },
    enabled: !!pduId,
  });

  const assignServer = useMutation({
    mutationFn: async (data: {
      pdu_id: string;
      outlet_number: number;
      server_id: string;
      feed_label: 'A' | 'B';
      notes?: string;
    }) => {
      const { error } = await supabase
        .from('server_pdu_mappings')
        .insert(data);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdu-outlet-assignments', pduId] });
      queryClient.invalidateQueries({ queryKey: ['server-pdu-mappings'] });
      toast.success('Server assigned to outlet');
    },
    onError: (error: Error) => {
      toast.error(`Failed to assign server: ${error.message}`);
    },
  });

  const unassignServer = useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await supabase
        .from('server_pdu_mappings')
        .delete()
        .eq('id', mappingId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdu-outlet-assignments', pduId] });
      queryClient.invalidateQueries({ queryKey: ['server-pdu-mappings'] });
      toast.success('Server unassigned from outlet');
    },
    onError: (error: Error) => {
      toast.error(`Failed to unassign server: ${error.message}`);
    },
  });

  return {
    assignments,
    isLoading,
    refetch,
    assignServer,
    unassignServer,
  };
}
