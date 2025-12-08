/**
 * Hook to fetch VMs from a specific vCenter
 * 
 * Returns VMs and unique cluster names for filtering
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VCenterVM {
  id: string;
  name: string;
  power_state?: string;
  guest_os?: string;
  cpu_count?: number;
  memory_mb?: number;
  disk_gb?: number;
  ip_address?: string;
  cluster_name?: string;
  is_template?: boolean;
}

export function useVCenterVMs(vcenterId?: string) {
  const query = useQuery({
    queryKey: ['vcenter-vms', vcenterId],
    queryFn: async () => {
      if (!vcenterId) return [];
      
      const { data, error } = await supabase
        .from('vcenter_vms')
        .select('*')
        .eq('source_vcenter_id', vcenterId)
        .order('name')
        .limit(10000);
      
      if (error) throw error;
      
      return (data || []).map(vm => ({
        id: vm.id,
        name: vm.name,
        power_state: vm.power_state,
        guest_os: vm.guest_os,
        cpu_count: vm.cpu_count,
        memory_mb: vm.memory_mb,
        disk_gb: vm.disk_gb,
        ip_address: vm.ip_address,
        cluster_name: vm.cluster_name,
        is_template: vm.is_template,
      })) as VCenterVM[];
    },
    enabled: !!vcenterId
  });

  // Extract unique cluster names from VMs
  const clusters = useMemo(() => {
    const clusterSet = new Set<string>();
    (query.data || []).forEach(vm => {
      if (vm.cluster_name) {
        clusterSet.add(vm.cluster_name);
      }
    });
    return Array.from(clusterSet).sort();
  }, [query.data]);

  return {
    ...query,
    clusters,
  };
}
