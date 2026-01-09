import { useQuery } from "@tanstack/react-query";
import { resolveProtectionGroupNetworks, getAllSourceNetworks, applyOverrides, ResolvedNetwork, NetworkResolutionResult } from "@/lib/networkResolution";
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

  // Resolve networks by VLAN ID based on VM network associations
  const { data: resolutionResult, isLoading, error, refetch } = useQuery({
    queryKey: ["resolved-networks", protectionGroupId, sourceVCenterId, targetVCenterId],
    queryFn: async () => {
      if (!protectionGroupId || !sourceVCenterId || !targetVCenterId) {
        return { networks: [], dataSource: 'none' as const, vmsMissingNetworkData: [] };
      }
      return resolveProtectionGroupNetworks(protectionGroupId, sourceVCenterId, targetVCenterId);
    },
    enabled: !!protectionGroupId && !!sourceVCenterId && !!targetVCenterId,
    staleTime: 30000
  });

  // Fallback: Get all source networks when VM network data is missing
  const { data: fallbackNetworks, isLoading: fallbackLoading } = useQuery({
    queryKey: ["all-source-networks", sourceVCenterId, targetVCenterId],
    queryFn: async () => {
      if (!sourceVCenterId || !targetVCenterId) return [];
      return getAllSourceNetworks(sourceVCenterId, targetVCenterId);
    },
    enabled: !!sourceVCenterId && !!targetVCenterId && resolutionResult?.dataSource === 'none'
  });

  // Determine which networks to use
  const dataSource = resolutionResult?.dataSource || 'none';
  const vmsMissingNetworkData = resolutionResult?.vmsMissingNetworkData || [];
  
  let baseNetworks: ResolvedNetwork[] = [];
  if (dataSource === 'vm_networks' && resolutionResult?.networks.length) {
    baseNetworks = resolutionResult.networks;
  } else if (fallbackNetworks?.length) {
    baseNetworks = fallbackNetworks;
  }

  // Apply overrides to resolved networks
  const networks: ResolvedNetwork[] = baseNetworks.length > 0 && overrides
    ? applyOverrides(baseNetworks, overrides)
    : baseNetworks;

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
    isLoading: isLoading || fallbackLoading,
    error,
    refetch,
    dataSource,
    vmsMissingNetworkData,
    useFallbackMode: dataSource === 'none' && !!fallbackNetworks?.length
  };
}
