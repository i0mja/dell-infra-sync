import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface VLANOption {
  value: string;
  label: string;
  vlanId: number;
  vmCount?: number;
}

export function useVLANOptions() {
  return useQuery({
    queryKey: ["vlan-options"],
    queryFn: async () => {
      // Get distinct VLAN IDs with a sample network name for labeling
      const { data, error } = await supabase
        .from("vcenter_networks")
        .select("vlan_id, name")
        .not("vlan_id", "is", null)
        .order("vlan_id");

      if (error) throw error;

      // Group by VLAN ID and pick the best name
      const vlanMap = new Map<number, string[]>();
      
      for (const row of data || []) {
        if (row.vlan_id != null) {
          if (!vlanMap.has(row.vlan_id)) {
            vlanMap.set(row.vlan_id, []);
          }
          if (row.name) {
            vlanMap.get(row.vlan_id)!.push(row.name);
          }
        }
      }

      // Convert to options array
      const options: VLANOption[] = [];
      
      vlanMap.forEach((names, vlanId) => {
        // Try to extract a meaningful label from the network names
        // e.g., "vlan 40 (Production)" -> "Production"
        let label = `VLAN ${vlanId}`;
        
        if (names.length > 0) {
          // Find a name with description in parentheses
          const nameWithDesc = names.find(n => n.includes('(') && n.includes(')'));
          if (nameWithDesc) {
            const match = nameWithDesc.match(/\(([^)]+)\)/);
            if (match) {
              label = `VLAN ${vlanId} (${match[1]})`;
            }
          }
        }
        
        options.push({
          value: vlanId.toString(),
          label,
          vlanId,
        });
      });

      return options.sort((a, b) => a.vlanId - b.vlanId);
    },
    staleTime: 60000,
  });
}
