import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ServerNic {
  id: string;
  server_id: string;
  fqdd: string;
  name: string | null;
  description: string | null;
  mac_address: string | null;
  permanent_mac_address: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  part_number: string | null;
  firmware_version: string | null;
  port_id: string | null;
  link_status: string | null;
  current_speed_mbps: number | null;
  max_speed_mbps: number | null;
  duplex: string | null;
  auto_negotiate: boolean | null;
  mtu: number | null;
  switch_connection_id: string | null;
  switch_port_description: string | null;
  switch_name: string | null;
  ipv4_addresses: string[] | null;
  ipv6_addresses: string[] | null;
  vlan_id: number | null;
  health: string | null;
  status: string | null;
  last_sync: string | null;
  created_at: string;
  updated_at: string;
}

export function useServerNics(serverId: string | null) {
  return useQuery({
    queryKey: ['server-nics', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      
      const { data, error } = await supabase
        .from('server_nics')
        .select('*')
        .eq('server_id', serverId)
        .order('fqdd', { ascending: true });
      
      if (error) throw error;
      return data as ServerNic[];
    },
    enabled: !!serverId,
  });
}
