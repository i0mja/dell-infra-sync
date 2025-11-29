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
}

export interface VCenterCluster {
  id: string;
  cluster_name: string;
  vcenter_id: string | null;
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

export function useVCenterData(selectedVCenterId?: string | null) {
  const [vms, setVms] = useState<VCenterVM[]>([]);
  const [clusters, setClusters] = useState<VCenterCluster[]>([]);
  const [datastores, setDatastores] = useState<VCenterDatastore[]>([]);
  const [alarms, setAlarms] = useState<VCenterAlarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [vmCount, setVmCount] = useState<number>(0);
  const [clusterCount, setClusterCount] = useState<number>(0);
  const [datastoreCount, setDatastoreCount] = useState<number>(0);
  const [alarmCount, setAlarmCount] = useState<number>(0);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Build queries with optional vCenter filtering and explicit ranges
      let vmsQuery = supabase.from("vcenter_vms").select("*", { count: "exact" });
      let clustersQuery = supabase.from("vcenter_clusters").select("*", { count: "exact" });
      let datastoresQuery = supabase.from("vcenter_datastores").select("*", { count: "exact" });
      let alarmsQuery = supabase.from("vcenter_alarms").select("*", { count: "exact" });

      // Apply filter if a specific vCenter is selected
      if (selectedVCenterId && selectedVCenterId !== "all") {
        vmsQuery = vmsQuery.eq("source_vcenter_id", selectedVCenterId);
        clustersQuery = clustersQuery.eq("source_vcenter_id", selectedVCenterId);
        datastoresQuery = datastoresQuery.eq("source_vcenter_id", selectedVCenterId);
        alarmsQuery = alarmsQuery.eq("source_vcenter_id", selectedVCenterId);
      }

      const [vmsResult, clustersResult, datastoresResult, alarmsResult] = await Promise.all([
        vmsQuery.range(0, 9999).order("name"),
        clustersQuery.range(0, 9999).order("cluster_name"),
        datastoresQuery.range(0, 9999).order("name"),
        alarmsQuery.range(0, 9999).order("triggered_at", { ascending: false }),
      ]);

      if (vmsResult.error) throw vmsResult.error;
      if (clustersResult.error) throw clustersResult.error;
      if (datastoresResult.error) throw datastoresResult.error;
      if (alarmsResult.error) throw alarmsResult.error;

      setVms(vmsResult.data || []);
      setClusters(clustersResult.data || []);
      setDatastores(datastoresResult.data || []);
      setAlarms(alarmsResult.data || []);
      setVmCount(vmsResult.count || 0);
      setClusterCount(clustersResult.count || 0);
      setDatastoreCount(datastoresResult.count || 0);
      setAlarmCount(alarmsResult.count || 0);
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

    return () => {
      vmsChannel.unsubscribe();
      clustersChannel.unsubscribe();
      datastoresChannel.unsubscribe();
      alarmsChannel.unsubscribe();
    };
  }, [selectedVCenterId]);

  return {
    vms,
    clusters,
    datastores,
    alarms,
    loading,
    vmCount,
    clusterCount,
    datastoreCount,
    alarmCount,
    refetch: fetchData,
  };
}
