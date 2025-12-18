import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface NetworkVm {
  id: string;
  network_id: string;
  vm_id: string;
  source_vcenter_id: string | null;
  nic_label: string | null;
  mac_address: string | null;
  ip_addresses: string[] | null;
  adapter_type: string | null;
  connected: boolean | null;
  last_sync: string | null;
  // Joined VM data
  vm?: {
    id: string;
    name: string;
    power_state: string | null;
    guest_os: string | null;
    cluster_name: string | null;
  };
}

export function useNetworkVms(
  networkIds: string | string[] | null,
  vcenterFilter?: string | null
) {
  const [vms, setVms] = useState<NetworkVm[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVms = useCallback(async () => {
    // Normalize to array
    const ids = networkIds 
      ? (Array.isArray(networkIds) ? networkIds : [networkIds]).filter(Boolean)
      : [];
    
    if (ids.length === 0) {
      setVms([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("vcenter_network_vms")
        .select(`
          id,
          network_id,
          vm_id,
          source_vcenter_id,
          nic_label,
          mac_address,
          ip_addresses,
          adapter_type,
          connected,
          last_sync,
          vm:vcenter_vms!vm_id (
            id,
            name,
            power_state,
            guest_os,
            cluster_name
          )
        `)
        .in("network_id", ids)
        .order("last_sync", { ascending: false });

      // Apply vCenter filter if specified and not "all"
      if (vcenterFilter && vcenterFilter !== "all") {
        query = query.eq("source_vcenter_id", vcenterFilter);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        throw fetchError;
      }

      // Transform the data to flatten the vm object
      const transformedData = (data || []).map((item: any) => ({
        ...item,
        vm: item.vm || undefined,
      }));

      setVms(transformedData);
    } catch (err: any) {
      console.error("Error fetching network VMs:", err);
      setError(err.message || "Failed to fetch VMs for network");
      setVms([]);
    } finally {
      setLoading(false);
    }
  }, [networkIds, vcenterFilter]);

  useEffect(() => {
    fetchVms();
  }, [fetchVms]);

  return {
    vms,
    loading,
    error,
    refetch: fetchVms,
  };
}
