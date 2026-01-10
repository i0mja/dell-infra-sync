import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Pdu, PduFormData, PduOutlet } from '@/types/pdu';

export function usePdus() {
  const queryClient = useQueryClient();

  const { data: pdus = [], isLoading, error, refetch } = useQuery({
    queryKey: ['pdus'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pdus')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return data as Pdu[];
    },
  });

  const addPdu = useMutation({
    mutationFn: async (data: PduFormData) => {
      const { data: pdu, error } = await supabase
        .from('pdus')
        .insert({
          name: data.name,
          ip_address: data.ip_address,
          hostname: data.hostname || null,
          username: data.username || 'apc',
          password_encrypted: data.password || null, // Encryption handled by job executor
          protocol: data.protocol || 'nmc',
          snmp_community: data.snmp_community || 'public',
          total_outlets: data.total_outlets || 8,
          datacenter: data.datacenter || null,
          rack_id: data.rack_id || null,
          notes: data.notes || null,
        })
        .select()
        .single();
      
      if (error) throw error;
      return pdu as Pdu;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdus'] });
      toast.success('PDU added successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to add PDU: ${error.message}`);
    },
  });

  const updatePdu = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PduFormData> }) => {
      const updateData: Record<string, unknown> = {
        name: data.name,
        ip_address: data.ip_address,
        hostname: data.hostname || null,
        username: data.username || 'apc',
        protocol: data.protocol || 'nmc',
        snmp_community: data.snmp_community || 'public',
        total_outlets: data.total_outlets || 8,
        datacenter: data.datacenter || null,
        rack_id: data.rack_id || null,
        notes: data.notes || null,
      };

      // Store password if provided (encryption handled by job executor)
      if (data.password) {
        updateData.password_encrypted = data.password;
      }

      const { data: pdu, error } = await supabase
        .from('pdus')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return pdu as Pdu;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdus'] });
      toast.success('PDU updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update PDU: ${error.message}`);
    },
  });

  const deletePdu = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pdus').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdus'] });
      toast.success('PDU deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete PDU: ${error.message}`);
    },
  });

  return {
    pdus,
    isLoading,
    error,
    refetch,
    addPdu,
    updatePdu,
    deletePdu,
  };
}

export function usePduOutlets(pduId: string | null) {
  const queryClient = useQueryClient();

  const { data: outlets = [], isLoading, refetch } = useQuery({
    queryKey: ['pdu-outlets', pduId],
    queryFn: async () => {
      if (!pduId) return [];
      
      const { data, error } = await supabase
        .from('pdu_outlets')
        .select('*')
        .eq('pdu_id', pduId)
        .order('outlet_number');
      
      if (error) throw error;
      return data as PduOutlet[];
    },
    enabled: !!pduId,
  });

  const updateOutletName = useMutation({
    mutationFn: async ({ outletId, name }: { outletId: string; name: string }) => {
      const { error } = await supabase
        .from('pdu_outlets')
        .update({ outlet_name: name })
        .eq('id', outletId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdu-outlets', pduId] });
    },
  });

  return {
    outlets,
    isLoading,
    refetch,
    updateOutletName,
  };
}
