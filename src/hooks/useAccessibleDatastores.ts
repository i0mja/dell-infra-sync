import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AccessibleDatastore {
  id: string;
  name: string;
  vcenter_id: string | null;
  capacity_bytes: number | null;
  free_bytes: number | null;
  type: string | null;
  accessible: boolean | null;
  host_count: number | null;
}

export function useAccessibleDatastores(
  vcenterId?: string,
  clusterName?: string
) {
  return useQuery({
    queryKey: ['accessible-datastores', vcenterId, clusterName],
    queryFn: async () => {
      if (!vcenterId) return [];

      // If no cluster filter, return all datastores for the vCenter
      if (!clusterName) {
        const { data, error } = await supabase
          .from('vcenter_datastores')
          .select('*')
          .eq('source_vcenter_id', vcenterId)
          .order('name');
        
        if (error) throw error;
        return data as AccessibleDatastore[];
      }

      // Get hosts in the specified cluster
      const { data: hosts, error: hostsError } = await supabase
        .from('vcenter_hosts')
        .select('id')
        .eq('source_vcenter_id', vcenterId)
        .eq('cluster', clusterName);
      
      if (hostsError) throw hostsError;
      if (!hosts?.length) return [];

      const hostIds = hosts.map(h => h.id);

      // Get datastores accessible by ALL hosts in the cluster
      const { data: datastoreHosts, error: dhError } = await supabase
        .from('vcenter_datastore_hosts')
        .select('datastore_id, host_id, accessible')
        .in('host_id', hostIds)
        .eq('accessible', true);

      if (dhError) throw dhError;
      if (!datastoreHosts?.length) return [];

      // Count how many cluster hosts can access each datastore
      const datastoreAccessCount: Record<string, number> = {};
      datastoreHosts.forEach(dh => {
        datastoreAccessCount[dh.datastore_id] = 
          (datastoreAccessCount[dh.datastore_id] || 0) + 1;
      });

      // Only include datastores accessible by ALL hosts in cluster
      const accessibleDatastoreIds = Object.entries(datastoreAccessCount)
        .filter(([_, count]) => count === hostIds.length)
        .map(([id]) => id);

      if (!accessibleDatastoreIds.length) return [];

      // Fetch the actual datastore details
      const { data: datastores, error: dsError } = await supabase
        .from('vcenter_datastores')
        .select('*')
        .in('id', accessibleDatastoreIds)
        .order('name');

      if (dsError) throw dsError;
      return (datastores || []) as AccessibleDatastore[];
    },
    enabled: !!vcenterId,
  });
}
