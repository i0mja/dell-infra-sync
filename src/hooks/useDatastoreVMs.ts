import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DatastoreVM {
  id: string;
  name: string;
  power_state: string | null;
  committed_bytes: number | null;
  uncommitted_bytes: number | null;
  is_primary_datastore: boolean;
}

export function useDatastoreVMs(datastoreId: string | null) {
  return useQuery({
    queryKey: ["datastore-vms", datastoreId],
    queryFn: async () => {
      if (!datastoreId) return [];

      // Query the junction table and join with vcenter_vms for VM details
      const { data, error } = await supabase
        .from("vcenter_datastore_vms")
        .select(`
          vm_id,
          committed_bytes,
          uncommitted_bytes,
          is_primary_datastore,
          vcenter_vms!inner (
            id,
            name,
            power_state
          )
        `)
        .eq("datastore_id", datastoreId)
        .order("is_primary_datastore", { ascending: false });

      if (error) throw error;

      // Map to DatastoreVM interface
      return (data || []).map((item: any) => ({
        id: item.vcenter_vms.id,
        name: item.vcenter_vms.name,
        power_state: item.vcenter_vms.power_state,
        committed_bytes: item.committed_bytes,
        uncommitted_bytes: item.uncommitted_bytes,
        is_primary_datastore: item.is_primary_datastore || false,
      })) as DatastoreVM[];
    },
    enabled: !!datastoreId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}
