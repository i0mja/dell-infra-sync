import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface VCenterVM {
  id: string;
  name: string;
  vcenter_id: string | null;
  cluster_name: string | null;
  host_id: string | null;
  power_state: string | null;
  guest_os: string | null;
  ip_address: string | null;
  cpu_count: number | null;
  memory_mb: number | null;
  disk_gb: number | null;
  tools_status: string | null;
  tools_version: string | null;
  overall_status: string | null;
  notes: string | null;
  last_sync: string | null;
  is_template: boolean | null;
}

export interface VCenterCluster {
  id: string;
  cluster_name: string;
  vcenter_id: string | null;
  source_vcenter_id: string | null;
  host_count: number | null;
  vm_count: number | null;
  ha_enabled: boolean | null;
  drs_enabled: boolean | null;
  drs_automation_level: string | null;
  overall_status: string | null;
  total_cpu_mhz: number | null;
  used_cpu_mhz: number | null;
  total_memory_bytes: number | null;
  used_memory_bytes: number | null;
  total_storage_bytes: number | null;
  used_storage_bytes: number | null;
  last_sync: string | null;
}

export interface VCenterDatastore {
  id: string;
  name: string;
  vcenter_id: string | null;
  type: string | null;
  capacity_bytes: number | null;
  free_bytes: number | null;
  accessible: boolean | null;
  maintenance_mode: string | null;
  vm_count: number | null;
  host_count: number | null;
  last_sync: string | null;
}

export interface VCenterAlarm {
  id: string;
  alarm_key: string;
  alarm_name: string | null;
  alarm_status: string | null;
  entity_type: string | null;
  entity_name: string | null;
  entity_id: string | null;
  description: string | null;
  acknowledged: boolean | null;
  triggered_at: string | null;
  created_at: string;
}

export interface VCenterNetwork {
  id: string;
  name: string;
  vcenter_id: string | null;
  source_vcenter_id: string | null;
  network_type: string | null;
  vlan_id: number | null;
  vlan_type: string | null;
  vlan_range: string | null;
  parent_switch_name: string | null;
  parent_switch_id: string | null;
  accessible: boolean | null;
  host_count: number | null;
  vm_count: number | null;
  uplink_port_group: boolean | null;
  last_sync: string | null;
}

export function useVCenterData(selectedVCenterId?: string | null) {
  const [vms, setVms] = useState<VCenterVM[]>([]);
  const [clusters, setClusters] = useState<VCenterCluster[]>([]);
  const [datastores, setDatastores] = useState<VCenterDatastore[]>([]);
  const [alarms, setAlarms] = useState<VCenterAlarm[]>([]);
  const [networks, setNetworks] = useState<VCenterNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [vmCount, setVmCount] = useState<number>(0);
  const [clusterCount, setClusterCount] = useState<number>(0);
  const [datastoreCount, setDatastoreCount] = useState<number>(0);
  const [alarmCount, setAlarmCount] = useState<number>(0);
  const [networkCount, setNetworkCount] = useState<number>(0);

  // Helper to fetch VMs in batches
  const fetchVMsInBatches = async (filterValue?: string): Promise<{ data: VCenterVM[], count: number }> => {
    const allData: VCenterVM[] = [];
    let from = 0;
    const batchSize = 1000;
    let totalCount = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from("vcenter_vms")
        .select("*", { count: from === 0 ? 'exact' : undefined })
        .order("name", { ascending: true })
        .range(from, from + batchSize - 1);

      if (filterValue && filterValue !== "all") {
        query = query.eq("source_vcenter_id", filterValue);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allData.push(...data);
        if (from === 0 && count !== null) {
          totalCount = count;
        }
        hasMore = data.length === batchSize;
        from += batchSize;
      } else {
        hasMore = false;
      }
    }

    return { data: allData, count: totalCount || allData.length };
  };

  // Helper to fetch Clusters in batches
  const fetchClustersInBatches = async (filterValue?: string): Promise<{ data: VCenterCluster[], count: number }> => {
    const allData: VCenterCluster[] = [];
    let from = 0;
    const batchSize = 1000;
    let totalCount = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from("vcenter_clusters")
        .select("*", { count: from === 0 ? 'exact' : undefined })
        .order("cluster_name", { ascending: true })
        .range(from, from + batchSize - 1);

      if (filterValue && filterValue !== "all") {
        query = query.eq("source_vcenter_id", filterValue);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allData.push(...data);
        if (from === 0 && count !== null) {
          totalCount = count;
        }
        hasMore = data.length === batchSize;
        from += batchSize;
      } else {
        hasMore = false;
      }
    }

    return { data: allData, count: totalCount || allData.length };
  };

  // Helper to fetch Datastores in batches
  const fetchDatastoresInBatches = async (filterValue?: string): Promise<{ data: VCenterDatastore[], count: number }> => {
    const allData: VCenterDatastore[] = [];
    let from = 0;
    const batchSize = 1000;
    let totalCount = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from("vcenter_datastores")
        .select("*", { count: from === 0 ? 'exact' : undefined })
        .order("name", { ascending: true })
        .range(from, from + batchSize - 1);

      if (filterValue && filterValue !== "all") {
        query = query.eq("source_vcenter_id", filterValue);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allData.push(...data);
        if (from === 0 && count !== null) {
          totalCount = count;
        }
        hasMore = data.length === batchSize;
        from += batchSize;
      } else {
        hasMore = false;
      }
    }

    return { data: allData, count: totalCount || allData.length };
  };

  // Helper to fetch Alarms in batches
  const fetchAlarmsInBatches = async (filterValue?: string): Promise<{ data: VCenterAlarm[], count: number }> => {
    const allData: VCenterAlarm[] = [];
    let from = 0;
    const batchSize = 1000;
    let totalCount = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from("vcenter_alarms")
        .select("*", { count: from === 0 ? 'exact' : undefined })
        .order("triggered_at", { ascending: false })
        .range(from, from + batchSize - 1);

      if (filterValue && filterValue !== "all") {
        query = query.eq("source_vcenter_id", filterValue);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allData.push(...data);
        if (from === 0 && count !== null) {
          totalCount = count;
        }
        hasMore = data.length === batchSize;
        from += batchSize;
      } else {
        hasMore = false;
      }
    }

    return { data: allData, count: totalCount || allData.length };
  };

  // Helper to fetch Networks in batches
  const fetchNetworksInBatches = async (filterValue?: string): Promise<{ data: VCenterNetwork[], count: number }> => {
    const allData: VCenterNetwork[] = [];
    let from = 0;
    const batchSize = 1000;
    let totalCount = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from("vcenter_networks")
        .select("*", { count: from === 0 ? 'exact' : undefined })
        .order("name", { ascending: true })
        .range(from, from + batchSize - 1);

      if (filterValue && filterValue !== "all") {
        query = query.eq("source_vcenter_id", filterValue);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allData.push(...data);
        if (from === 0 && count !== null) {
          totalCount = count;
        }
        hasMore = data.length === batchSize;
        from += batchSize;
      } else {
        hasMore = false;
      }
    }

    return { data: allData, count: totalCount || allData.length };
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      
      const filterValue = selectedVCenterId && selectedVCenterId !== "all" 
        ? selectedVCenterId 
        : undefined;

      // Fetch all data in batches (handles >1000 rows)
      const [vmsResult, clustersResult, datastoresResult, alarmsResult, networksResult] = await Promise.all([
        fetchVMsInBatches(filterValue),
        fetchClustersInBatches(filterValue),
        fetchDatastoresInBatches(filterValue),
        fetchAlarmsInBatches(filterValue),
        fetchNetworksInBatches(filterValue),
      ]);

      setVms(vmsResult.data);
      setClusters(clustersResult.data);
      setDatastores(datastoresResult.data);
      setAlarms(alarmsResult.data);
      setNetworks(networksResult.data);
      setVmCount(vmsResult.count);
      setClusterCount(clustersResult.count);
      setDatastoreCount(datastoresResult.count);
      setAlarmCount(alarmsResult.count);
      setNetworkCount(networksResult.count);
    } catch (error) {
      console.error("Error fetching vCenter data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Subscribe to realtime changes
    const vmsChannel = supabase
      .channel("vcenter_vms_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "vcenter_vms" }, () => fetchData())
      .subscribe();

    const clustersChannel = supabase
      .channel("vcenter_clusters_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "vcenter_clusters" }, () => fetchData())
      .subscribe();

    const datastoresChannel = supabase
      .channel("vcenter_datastores_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "vcenter_datastores" }, () => fetchData())
      .subscribe();

    const alarmsChannel = supabase
      .channel("vcenter_alarms_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "vcenter_alarms" }, () => fetchData())
      .subscribe();

    const networksChannel = supabase
      .channel("vcenter_networks_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "vcenter_networks" }, () => fetchData())
      .subscribe();

    return () => {
      vmsChannel.unsubscribe();
      clustersChannel.unsubscribe();
      datastoresChannel.unsubscribe();
      alarmsChannel.unsubscribe();
      networksChannel.unsubscribe();
    };
  }, [selectedVCenterId]);

  return {
    vms,
    clusters,
    datastores,
    alarms,
    networks,
    loading,
    vmCount,
    clusterCount,
    datastoreCount,
    alarmCount,
    networkCount,
    refetch: fetchData,
  };
}
