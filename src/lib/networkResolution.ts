import { supabase } from "@/integrations/supabase/client";

export interface ResolvedNetwork {
  sourceNetworkId: string;
  sourceNetworkName: string;
  sourceVlanId: number | null;
  targetNetworkId: string | null;
  targetNetworkName: string | null;
  targetVlanId: number | null;
  status: 'matched' | 'ambiguous' | 'not_found' | 'no_vlan';
  candidates?: Array<{ id: string; name: string; vlanId: number }>;
}

/**
 * Resolve networks for VMs in a protection group to target vCenter by VLAN ID.
 * Returns a map of source network ID -> resolution result.
 */
export async function resolveProtectionGroupNetworks(
  protectionGroupId: string,
  sourceVCenterId: string,
  targetVCenterId: string
): Promise<ResolvedNetwork[]> {
  // 1. Get all VMs in this protection group
  const { data: protectedVms, error: vmError } = await supabase
    .from("protected_vms")
    .select("vm_id")
    .eq("protection_group_id", protectionGroupId)
    .not("vm_id", "is", null);

  if (vmError) throw vmError;

  const vmIds = protectedVms?.map(v => v.vm_id).filter(Boolean) as string[];
  if (!vmIds.length) return [];

  // 2. Get networks attached to these VMs
  const { data: vmNetworks, error: networkError } = await supabase
    .from("vcenter_network_vms")
    .select(`
      vm_id,
      network_id,
      vcenter_networks!inner(
        id,
        name,
        vlan_id,
        vcenter_id
      )
    `)
    .in("vm_id", vmIds);

  if (networkError) throw networkError;

  // 3. Get all networks from target vCenter
  const { data: targetNetworks, error: targetError } = await supabase
    .from("vcenter_networks")
    .select("id, name, vlan_id")
    .eq("vcenter_id", targetVCenterId);

  if (targetError) throw targetError;

  // 4. Build unique source networks map
  const sourceNetworksMap = new Map<string, {
    id: string;
    name: string;
    vlanId: number | null;
  }>();

  for (const row of vmNetworks || []) {
    const network = row.vcenter_networks as any;
    if (network && !sourceNetworksMap.has(network.id)) {
      sourceNetworksMap.set(network.id, {
        id: network.id,
        name: network.name,
        vlanId: network.vlan_id
      });
    }
  }

  // 5. Resolve each source network to target
  const results: ResolvedNetwork[] = [];

  for (const [, sourceNetwork] of sourceNetworksMap) {
    const result: ResolvedNetwork = {
      sourceNetworkId: sourceNetwork.id,
      sourceNetworkName: sourceNetwork.name,
      sourceVlanId: sourceNetwork.vlanId,
      targetNetworkId: null,
      targetNetworkName: null,
      targetVlanId: null,
      status: 'no_vlan'
    };

    if (sourceNetwork.vlanId == null) {
      // No VLAN ID - try exact name match as fallback
      const nameMatch = targetNetworks?.find(t => t.name === sourceNetwork.name);
      if (nameMatch) {
        result.targetNetworkId = nameMatch.id;
        result.targetNetworkName = nameMatch.name;
        result.targetVlanId = nameMatch.vlan_id;
        result.status = 'matched';
      }
      results.push(result);
      continue;
    }

    // Find networks on target site with same VLAN ID
    const matches = targetNetworks?.filter(t => t.vlan_id === sourceNetwork.vlanId) || [];

    if (matches.length === 0) {
      result.status = 'not_found';
    } else if (matches.length === 1) {
      result.targetNetworkId = matches[0].id;
      result.targetNetworkName = matches[0].name;
      result.targetVlanId = matches[0].vlan_id;
      result.status = 'matched';
    } else {
      // Multiple matches - ambiguous
      result.status = 'ambiguous';
      result.candidates = matches.map(m => ({
        id: m.id,
        name: m.name,
        vlanId: m.vlan_id!
      }));
      // Default to first match but flag as ambiguous
      result.targetNetworkId = matches[0].id;
      result.targetNetworkName = matches[0].name;
      result.targetVlanId = matches[0].vlan_id;
    }

    results.push(result);
  }

  return results;
}

/**
 * Apply manual overrides to resolved networks.
 * Overrides take precedence over auto-resolution.
 */
export function applyOverrides(
  resolved: ResolvedNetwork[],
  overrides: Array<{ source_network: string; target_network: string }>
): ResolvedNetwork[] {
  const overrideMap = new Map(overrides.map(o => [o.source_network, o.target_network]));

  return resolved.map(r => {
    const override = overrideMap.get(r.sourceNetworkName);
    if (override) {
      return {
        ...r,
        targetNetworkName: override,
        status: 'matched' as const
      };
    }
    return r;
  });
}
