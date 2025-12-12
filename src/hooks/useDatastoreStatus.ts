/**
 * useDatastoreStatus Hook
 * 
 * Fetches datastore mount status from the database by joining
 * vcenter_datastores → vcenter_datastore_hosts → vcenter_hosts
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface HostMountStatus {
  host_id: string;
  host_name: string;
  cluster: string | null;
  connected: boolean;
  mounted: boolean;
  mount_path?: string | null;
  accessible?: boolean;
}

export interface DatastoreStatus {
  datastore_id: string | null;
  datastore_name: string | null;
  datastore_type: string | null;
  capacity_bytes: number | null;
  free_bytes: number | null;
  hosts: HostMountStatus[];
  mounted_count: number;
  total_hosts: number;
  last_sync: string | null;
}

export function useDatastoreStatus(
  targetId: string | null,
  vcenterId: string | null,
  datastoreName: string | null
) {
  const [status, setStatus] = useState<DatastoreStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!vcenterId) {
      setStatus(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // First, get all hosts for this vCenter
      const { data: allHosts, error: hostsError } = await supabase
        .from('vcenter_hosts')
        .select('id, name, cluster, status')
        .eq('source_vcenter_id', vcenterId)
        .order('cluster', { ascending: true })
        .order('name', { ascending: true });

      if (hostsError) throw hostsError;

      // Try to find the datastore by name or by replication_target_id
      let datastoreQuery = supabase
        .from('vcenter_datastores')
        .select('id, name, type, capacity_bytes, free_bytes, last_sync, replication_target_id')
        .eq('source_vcenter_id', vcenterId);

      if (targetId) {
        // First try by replication_target_id
        const { data: linkedDs } = await datastoreQuery
          .eq('replication_target_id', targetId)
          .maybeSingle();

        if (linkedDs) {
          // Found by replication_target_id
          await processDatastoreStatus(linkedDs, allHosts || []);
          return;
        }
      }

      // Try by name if we have one
      if (datastoreName) {
        const { data: namedDs } = await supabase
          .from('vcenter_datastores')
          .select('id, name, type, capacity_bytes, free_bytes, last_sync, replication_target_id')
          .eq('source_vcenter_id', vcenterId)
          .eq('name', datastoreName)
          .maybeSingle();

        if (namedDs) {
          await processDatastoreStatus(namedDs, allHosts || []);
          return;
        }
      }

      // No datastore found - return all hosts as unmounted
      setStatus({
        datastore_id: null,
        datastore_name: datastoreName,
        datastore_type: null,
        capacity_bytes: null,
        free_bytes: null,
        hosts: (allHosts || []).map(h => ({
          host_id: h.id,
          host_name: h.name,
          cluster: h.cluster,
          connected: h.status === 'connected',
          mounted: false,
        })),
        mounted_count: 0,
        total_hosts: allHosts?.length || 0,
        last_sync: null,
      });

    } catch (err) {
      console.error('Failed to fetch datastore status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }

    async function processDatastoreStatus(
      datastore: {
        id: string;
        name: string;
        type: string | null;
        capacity_bytes: number | null;
        free_bytes: number | null;
        last_sync: string | null;
        replication_target_id: string | null;
      },
      allHosts: Array<{ id: string; name: string; cluster: string | null; status: string }>
    ) {
      // Get mount info for this datastore
      const { data: mountInfo, error: mountError } = await supabase
        .from('vcenter_datastore_hosts')
        .select('host_id, mount_path, accessible')
        .eq('datastore_id', datastore.id);

      if (mountError) throw mountError;

      const mountedHostIds = new Set((mountInfo || []).map(m => m.host_id));
      const mountMap = new Map((mountInfo || []).map(m => [m.host_id, m]));

      const hosts: HostMountStatus[] = allHosts.map(h => {
        const mount = mountMap.get(h.id);
        return {
          host_id: h.id,
          host_name: h.name,
          cluster: h.cluster,
          connected: h.status === 'connected',
          mounted: mountedHostIds.has(h.id),
          mount_path: mount?.mount_path,
          accessible: mount?.accessible,
        };
      });

      setStatus({
        datastore_id: datastore.id,
        datastore_name: datastore.name,
        datastore_type: datastore.type,
        capacity_bytes: datastore.capacity_bytes,
        free_bytes: datastore.free_bytes,
        hosts,
        mounted_count: mountedHostIds.size,
        total_hosts: allHosts.length,
        last_sync: datastore.last_sync,
      });
    }
  }, [targetId, vcenterId, datastoreName]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    status,
    loading,
    error,
    refetch: fetchStatus,
  };
}
