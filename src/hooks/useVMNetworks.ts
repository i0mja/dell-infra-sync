import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface VMNetwork {
  id: string;
  network_name: string;
  vlan_id: number | null;
  network_type: string | null;
  nic_label: string | null;
  mac_address: string | null;
  ip_addresses: string[] | null;
  adapter_type: string | null;
  connected: boolean;
}

export function useVMNetworks(vmId: string | null) {
  return useQuery({
    queryKey: ["vm-networks", vmId],
    queryFn: async () => {
      if (!vmId) return [];

      const { data, error } = await supabase
        .from("vcenter_network_vms")
        .select(`
          id,
          nic_label,
          mac_address,
          ip_addresses,
          adapter_type,
          connected,
          vcenter_networks!inner (
            id,
            name,
            vlan_id,
            network_type
          )
        `)
        .eq("vm_id", vmId);

      if (error) throw error;

      return (data || []).map((item: any) => ({
        id: item.id,
        network_name: item.vcenter_networks.name,
        vlan_id: item.vcenter_networks.vlan_id,
        network_type: item.vcenter_networks.network_type,
        nic_label: item.nic_label,
        mac_address: item.mac_address,
        ip_addresses: item.ip_addresses,
        adapter_type: item.adapter_type,
        connected: item.connected ?? true,
      })) as VMNetwork[];
    },
    enabled: !!vmId,
    staleTime: 2 * 60 * 1000,
  });
}
