import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface VMDatastore {
  id: string;
  name: string;
  type: string | null;
  capacity_bytes: number | null;
  free_bytes: number | null;
  committed_bytes: number | null;
  uncommitted_bytes: number | null;
  is_primary_datastore: boolean;
}

export function useVMDatastores(vmId: string | null) {
  return useQuery({
    queryKey: ["vm-datastores", vmId],
    queryFn: async () => {
      if (!vmId) return [];

      const { data, error } = await supabase
        .from("vcenter_datastore_vms")
        .select(`
          datastore_id,
          committed_bytes,
          uncommitted_bytes,
          is_primary_datastore,
          vcenter_datastores!inner (
            id,
            name,
            type,
            capacity_bytes,
            free_bytes
          )
        `)
        .eq("vm_id", vmId)
        .order("is_primary_datastore", { ascending: false });

      if (error) throw error;

      return (data || []).map((item: any) => ({
        id: item.vcenter_datastores.id,
        name: item.vcenter_datastores.name,
        type: item.vcenter_datastores.type,
        capacity_bytes: item.vcenter_datastores.capacity_bytes,
        free_bytes: item.vcenter_datastores.free_bytes,
        committed_bytes: item.committed_bytes,
        uncommitted_bytes: item.uncommitted_bytes,
        is_primary_datastore: item.is_primary_datastore || false,
      })) as VMDatastore[];
    },
    enabled: !!vmId,
    staleTime: 2 * 60 * 1000,
  });
}
