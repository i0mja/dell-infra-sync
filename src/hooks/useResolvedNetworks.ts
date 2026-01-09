import { useQuery } from "@tanstack/react-query";
import { resolveProtectionGroupNetworks, applyOverrides, ResolvedNetwork } from "@/lib/networkResolution";
import { supabase } from "@/integrations/supabase/client";

export function useResolvedNetworks(
  protectionGroupId: string | undefined,
  sourceVCenterId: string | undefined,
  targetVCenterId: string | undefined
) {
  // Fetch manual overrides
  const { data: overrides } = useQuery({
    queryKey: ["network-mapping-overrides", protectionGroupId],
    queryFn: async () => {
      if (!protectionGroupId) return [];
      const { data, error } = await supabase
        .from("protection_group_network_mappings")
        .select("source_network, target_network")
        .eq("protection_group_id", protectionGroupId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!protectionGroupId
  });

  // Resolve networks by VLAN ID
  const { data: resolved, isLoading, error, refetch } = useQuery({
    queryKey: ["resolved-networks", protectionGroupId, sourceVCenterId, targetVCenterId],
    queryFn: async () => {
      if (!protectionGroupId || !sourceVCenterId || !targetVCenterId) {
        return [];
      }
      return resolveProtectionGroupNetworks(protectionGroupId, sourceVCenterId, targetVCenterId);
    },
    enabled: !!protectionGroupId && !!sourceVCenterId && !!targetVCenterId,
    staleTime: 30000
  });

  // Apply overrides to resolved networks
  const networks: ResolvedNetwork[] = resolved && overrides
    ? applyOverrides(resolved, overrides)
    : resolved || [];

  const stats = {
    total: networks.length,
    matched: networks.filter(n => n.status === 'matched').length,
    notFound: networks.filter(n => n.status === 'not_found').length,
    ambiguous: networks.filter(n => n.status === 'ambiguous').length,
    noVlan: networks.filter(n => n.status === 'no_vlan').length
  };

  return {
    networks,
    stats,
    isLoading,
    error,
    refetch
  };
}
