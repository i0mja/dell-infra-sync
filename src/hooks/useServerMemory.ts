import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ServerMemory {
  id: string;
  server_id: string;
  dimm_identifier: string;
  slot_name: string | null;
  manufacturer: string | null;
  part_number: string | null;
  serial_number: string | null;
  capacity_mb: number | null;
  speed_mhz: number | null;
  memory_type: string | null;
  rank_count: number | null;
  health: string | null;
  status: string | null;
  operating_speed_mhz: number | null;
  error_correction: string | null;
  volatile_size_mb: number | null;
  non_volatile_size_mb: number | null;
  last_updated_at: string | null;
  created_at: string | null;
}

export function useServerMemory(serverId: string | undefined) {
  return useQuery({
    queryKey: ['server-memory', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      const { data, error } = await supabase
        .from('server_memory')
        .select('*')
        .eq('server_id', serverId)
        .order('slot_name', { ascending: true });
      if (error) throw error;
      return data as ServerMemory[];
    },
    enabled: !!serverId,
  });
}
