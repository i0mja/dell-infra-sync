import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ServerDrive {
  id: string;
  server_id: string;
  name: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  part_number: string | null;
  media_type: string | null;
  protocol: string | null;
  capacity_bytes: number | null;
  capacity_gb: number | null;
  slot: string | null;
  enclosure: string | null;
  controller: string | null;
  health: string | null;
  status: string | null;
  predicted_failure: boolean;
  life_remaining_percent: number | null;
  firmware_version: string | null;
  rotation_speed_rpm: number | null;
  capable_speed_gbps: number | null;
  last_sync: string;
  created_at: string;
}

export function useServerDrives(serverId: string | null) {
  return useQuery({
    queryKey: ['server-drives', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      
      const { data, error } = await supabase
        .from('server_drives')
        .select('*')
        .eq('server_id', serverId)
        .order('slot', { ascending: true, nullsFirst: false });
      
      if (error) throw error;
      return data as ServerDrive[];
    },
    enabled: !!serverId,
  });
}
