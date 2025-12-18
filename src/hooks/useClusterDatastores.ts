import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClusterDatastore {
  id: string;
  name: string;
  type: string | null;
  capacity_bytes: number | null;
  free_bytes: number | null;
  accessible_host_count: number;
  total_cluster_hosts: number;
  is_shared: boolean; // true if accessible by ALL hosts in cluster
}

export function useClusterDatastores(
  vcenterId: string | null | undefined,
  clusterName: string | null | undefined
) {
  return useQuery({
    queryKey: ['cluster-datastores', vcenterId, clusterName],
    queryFn: async (): Promise<ClusterDatastore[]> => {
      if (!vcenterId || !clusterName) return [];

      // Get hosts in the specified cluster
      const { data: hosts, error: hostsError } = await supabase
        .from('vcenter_hosts')
        .select('id')
        .eq('source_vcenter_id', vcenterId)
        .eq('cluster', clusterName);
      
      if (hostsError) throw hostsError;
      if (!hosts?.length) return [];

      const hostIds = hosts.map(h => h.id);
      const totalClusterHosts = hostIds.length;

      // Get datastore-host relationships for cluster hosts
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

      const datastoreIds = Object.keys(datastoreAccessCount);
      if (!datastoreIds.length) return [];

      // Fetch datastore details
      const { data: datastores, error: dsError } = await supabase
        .from('vcenter_datastores')
        .select('id, name, type, capacity_bytes, free_bytes')
        .in('id', datastoreIds)
        .order('name');

      if (dsError) throw dsError;

      // Map to ClusterDatastore with shared info
      return (datastores || []).map(ds => ({
        id: ds.id,
        name: ds.name,
        type: ds.type,
        capacity_bytes: ds.capacity_bytes,
        free_bytes: ds.free_bytes,
        accessible_host_count: datastoreAccessCount[ds.id] || 0,
        total_cluster_hosts: totalClusterHosts,
        is_shared: datastoreAccessCount[ds.id] === totalClusterHosts,
      })).sort((a, b) => {
        // Shared first, then by name
        if (a.is_shared !== b.is_shared) return a.is_shared ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    },
    enabled: !!vcenterId && !!clusterName,
  });
}
