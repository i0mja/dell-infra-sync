import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface VMVLANMapping {
  vm_id: string;
  vlan_ids: number[];
}

export function useVMVLANMapping() {
  return useQuery({
    queryKey: ["vm-vlan-mapping"],
    queryFn: async () => {
      // Get all VM to network relationships with VLAN IDs
      const { data, error } = await supabase
        .from("vcenter_network_vms")
        .select(`
          vm_id,
          vcenter_networks!inner(vlan_id)
        `)
        .not("vcenter_networks.vlan_id", "is", null);

      if (error) throw error;

      // Build a map of VM ID -> array of VLAN IDs
      const mapping = new Map<string, Set<number>>();
      
      for (const row of data || []) {
        const vmId = row.vm_id;
        const vlanId = (row.vcenter_networks as any)?.vlan_id;
        
        if (vmId && vlanId != null) {
          if (!mapping.has(vmId)) {
            mapping.set(vmId, new Set());
          }
          mapping.get(vmId)!.add(vlanId);
        }
      }

      // Convert Sets to arrays
      const result = new Map<string, number[]>();
      mapping.forEach((vlanSet, vmId) => {
        result.set(vmId, Array.from(vlanSet).sort((a, b) => a - b));
      });

      return result;
    },
    staleTime: 60000, // Cache for 1 minute
  });
}
