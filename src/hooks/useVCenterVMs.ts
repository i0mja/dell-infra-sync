/**
 * Hook to fetch VMs from a specific vCenter
 * 
 * Returns VMs and unique cluster names for filtering
 * Uses pagination to fetch all VMs beyond the 1000 row limit
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
  vcenter_id?: string; // VMware moref (e.g., vm-123)
}

const BATCH_SIZE = 1000;
const MAX_VMS = 50000; // Safety limit

export function useVCenterVMs(vcenterId?: string) {
  const query = useQuery({
    queryKey: ['vcenter-vms', vcenterId],
    queryFn: async () => {
      if (!vcenterId) {
        console.log('[useVCenterVMs] No vcenterId provided, returning empty');
        return [];
      }
      
      console.log('[useVCenterVMs] Fetching VMs for vCenter:', vcenterId);
      
      // Paginated fetch to get all VMs beyond 1000 limit
      let allVMs: any[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('vcenter_vms')
          .select('*')
          .eq('source_vcenter_id', vcenterId)
          .order('name')
          .range(from, from + BATCH_SIZE - 1);
        
        if (error) {
          console.error('[useVCenterVMs] Error fetching VMs:', error);
          throw error;
        }
        
        if (data && data.length > 0) {
          allVMs = [...allVMs, ...data];
          from += BATCH_SIZE;
          console.log(`[useVCenterVMs] Fetched batch, total so far: ${allVMs.length}`);
          
          // If we got less than BATCH_SIZE, we've reached the end
          if (data.length < BATCH_SIZE) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
        
        // Safety limit
        if (from >= MAX_VMS) {
          console.warn('[useVCenterVMs] Reached safety limit of 50,000 VMs');
          hasMore = false;
        }
      }

      console.log(`[useVCenterVMs] Loaded ${allVMs.length} VMs for vCenter ${vcenterId}`);
      
      return allVMs.map(vm => ({
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
        vcenter_id: vm.vcenter_id,
      })) as VCenterVM[];
    },
    enabled: !!vcenterId,
    staleTime: 5 * 60 * 1000, // 5 minute cache
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
