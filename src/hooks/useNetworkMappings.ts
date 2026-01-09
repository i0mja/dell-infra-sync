import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface NetworkMapping {
  id: string;
  protection_group_id: string;
  source_network: string;
  target_network: string;
  is_test_network: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateNetworkMapping {
  protection_group_id: string;
  source_network: string;
  target_network: string;
  is_test_network?: boolean;
}

export function useNetworkMappings(protectionGroupId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading, error } = useQuery({
    queryKey: ["network-mappings", protectionGroupId],
    queryFn: async () => {
      if (!protectionGroupId) return [];
      
      const { data, error } = await supabase
        .from("protection_group_network_mappings")
        .select("*")
        .eq("protection_group_id", protectionGroupId)
        .order("source_network");

      if (error) throw error;
      return data as NetworkMapping[];
    },
    enabled: !!protectionGroupId,
  });

  const addMapping = useMutation({
    mutationFn: async (mapping: CreateNetworkMapping) => {
      const { data, error } = await supabase
        .from("protection_group_network_mappings")
        .insert({
          protection_group_id: mapping.protection_group_id,
          source_network: mapping.source_network,
          target_network: mapping.target_network,
          is_test_network: mapping.is_test_network || false,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["network-mappings", protectionGroupId] });
      toast.success("Network mapping added");
    },
    onError: (error) => {
      toast.error("Failed to add network mapping: " + error.message);
    },
  });

  const updateMapping = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<NetworkMapping> }) => {
      const { data, error } = await supabase
        .from("protection_group_network_mappings")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["network-mappings", protectionGroupId] });
      toast.success("Network mapping updated");
    },
    onError: (error) => {
      toast.error("Failed to update network mapping: " + error.message);
    },
  });

  const removeMapping = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("protection_group_network_mappings")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["network-mappings", protectionGroupId] });
      toast.success("Network mapping removed");
    },
    onError: (error) => {
      toast.error("Failed to remove network mapping: " + error.message);
    },
  });

  return {
    mappings,
    isLoading,
    error,
    addMapping,
    updateMapping,
    removeMapping,
  };
}
