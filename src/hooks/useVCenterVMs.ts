/**
 * Hook to fetch VMs from a specific vCenter
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface VCenterVM {
  id: string;
  name: string;
  moref?: string;
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
  return useQuery({
    queryKey: ['vcenter-vms', vcenterId],
    queryFn: async () => {
      if (!vcenterId) return [];
      
      const { data, error } = await supabase
        .from('vcenter_vms')
        .select('*')
        .eq('vcenter_id', vcenterId)
        .order('name');
      
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
}
