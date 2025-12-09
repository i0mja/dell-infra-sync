import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AccessibleDatastore {
  id: string;
  name: string;
  vcenter_id: string | null;
  source_vcenter_id: string | null;
  capacity_bytes: number | null;
  free_bytes: number | null;
  type: string | null;
  accessible: boolean | null;
  host_count: number | null;
  replication_target_id: string | null;
  // Joined target info
  replication_target?: {
    id: string;
    name: string;
    hostname: string;
    zfs_pool: string;
    health_status: string;
    partner_target_id: string | null;
    partner_target?: {
      id: string;
      name: string;
      hostname: string;
      dr_vcenter_id: string | null;
    } | null;
  } | null;
}

export function useAccessibleDatastores(
  vcenterId?: string,
  clusterName?: string
) {
  return useQuery({
    queryKey: ['accessible-datastores', vcenterId, clusterName],
    queryFn: async () => {
      if (!vcenterId) return [];

      // If no cluster filter, return all datastores for the vCenter with target info
      if (!clusterName) {
        const { data, error } = await supabase
          .from('vcenter_datastores')
          .select(`
            *,
            replication_target:replication_targets!replication_target_id(
              id,
              name,
              hostname,
              zfs_pool,
              health_status,
              partner_target_id
            )
          `)
          .eq('source_vcenter_id', vcenterId)
          .order('name');
        
        if (error) throw error;

        // Fetch partner target info for targets that have partners
        const datastoresWithTargets = data || [];
        const partnerIds = datastoresWithTargets
          .filter(ds => ds.replication_target?.partner_target_id)
          .map(ds => ds.replication_target!.partner_target_id as string);

        let partnerMap: Record<string, { id: string; name: string; hostname: string; dr_vcenter_id: string | null }> = {};
        if (partnerIds.length > 0) {
          const { data: partners } = await supabase
            .from('replication_targets')
            .select('id, name, hostname, dr_vcenter_id')
            .in('id', partnerIds);
          
          if (partners) {
            partnerMap = Object.fromEntries(partners.map(p => [p.id, p]));
          }
        }

        return datastoresWithTargets.map(ds => ({
          ...ds,
          replication_target: ds.replication_target ? {
            ...ds.replication_target,
            partner_target: ds.replication_target.partner_target_id 
              ? partnerMap[ds.replication_target.partner_target_id] || null
              : null
          } : null
        })) as AccessibleDatastore[];
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

      // Fetch the actual datastore details with target info
      const { data: datastores, error: dsError } = await supabase
        .from('vcenter_datastores')
        .select(`
          *,
          replication_target:replication_targets!replication_target_id(
            id,
            name,
            hostname,
            zfs_pool,
            health_status,
            partner_target_id
          )
        `)
        .in('id', accessibleDatastoreIds)
        .order('name');

      if (dsError) throw dsError;
      return (datastores || []) as AccessibleDatastore[];
    },
    enabled: !!vcenterId,
  });
}
