import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ServerPduMapping } from '@/types/pdu';

export function useServerPduMappings(serverId: string | null) {
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading, refetch } = useQuery({
    queryKey: ['server-pdu-mappings', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      
      const { data, error } = await supabase
        .from('server_pdu_mappings')
        .select(`
          *,
          pdu:pdus(*)
        `)
        .eq('server_id', serverId)
        .order('feed_label');
      
      if (error) throw error;
      
      // Fetch outlet info for each mapping
      const mappingsWithOutlets = await Promise.all(
        (data || []).map(async (mapping) => {
          const { data: outlet } = await supabase
            .from('pdu_outlets')
            .select('*')
            .eq('pdu_id', mapping.pdu_id)
            .eq('outlet_number', mapping.outlet_number)
            .single();
          
          return { ...mapping, outlet } as ServerPduMapping;
        })
      );
      
      return mappingsWithOutlets;
    },
    enabled: !!serverId,
  });

  const addMapping = useMutation({
    mutationFn: async (data: {
      server_id: string;
      pdu_id: string;
      outlet_number: number;
      feed_label: 'A' | 'B';
      notes?: string;
    }) => {
      const { error } = await supabase
        .from('server_pdu_mappings')
        .insert(data);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-pdu-mappings', serverId] });
      toast.success('PDU outlet mapping added');
    },
    onError: (error: Error) => {
      toast.error(`Failed to add mapping: ${error.message}`);
    },
  });

  const removeMapping = useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await supabase
        .from('server_pdu_mappings')
        .delete()
        .eq('id', mappingId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-pdu-mappings', serverId] });
      toast.success('PDU outlet mapping removed');
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove mapping: ${error.message}`);
    },
  });

  return {
    mappings,
    isLoading,
    refetch,
    addMapping,
    removeMapping,
  };
}
