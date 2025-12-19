import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface VMHost {
  id: string;
  name: string;
  cluster: string | null;
  esxi_version: string | null;
  status: string | null;
  maintenance_mode: boolean | null;
  serial_number: string | null;
  server_id: string | null;
}

export function useVMHost(hostId: string | null) {
  return useQuery({
    queryKey: ["vm-host", hostId],
    queryFn: async () => {
      if (!hostId) return null;

      const { data, error } = await supabase
        .from("vcenter_hosts")
        .select(`
          id,
          name,
          cluster,
          esxi_version,
          status,
          maintenance_mode,
          serial_number,
          server_id
        `)
        .eq("id", hostId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      return data as VMHost;
    },
    enabled: !!hostId,
    staleTime: 2 * 60 * 1000,
  });
}
