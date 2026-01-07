/**
 * Hook to fetch protection group storage data for dynamic disk sizing.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProtectionGroupStorage {
  id: string;
  name: string;
  description: string | null;
  vmCount: number;
  totalStorageBytes: number;
  isEnabled: boolean;
}

export function useProtectionGroupStorage() {
  return useQuery({
    queryKey: ['protection-groups-storage'],
    queryFn: async (): Promise<ProtectionGroupStorage[]> => {
      // Fetch protection groups with their VM counts and storage totals
      const { data: groups, error: groupsError } = await supabase
        .from('protection_groups')
        .select(`
          id,
          name,
          description,
          is_enabled
        `)
        .eq('is_enabled', true)
        .order('name');

      if (groupsError) throw groupsError;
      if (!groups) return [];

      // For each group, get VM counts and storage totals
      const results = await Promise.all(
        groups.map(async (group) => {
          const { data: vms, error: vmsError } = await supabase
            .from('protected_vms')
            .select('current_dataset_size')
            .eq('protection_group_id', group.id);

          if (vmsError) {
            console.error(`Error fetching VMs for group ${group.id}:`, vmsError);
            return {
              id: group.id,
              name: group.name,
              description: group.description,
              vmCount: 0,
              totalStorageBytes: 0,
              isEnabled: group.is_enabled ?? true,
            };
          }

          const vmCount = vms?.length || 0;
          const totalStorageBytes = vms?.reduce((sum, vm) => 
            sum + (vm.current_dataset_size || 0), 0) || 0;

          return {
            id: group.id,
            name: group.name,
            description: group.description,
            vmCount,
            totalStorageBytes,
            isEnabled: group.is_enabled ?? true,
          };
        })
      );

      return results;
    },
    staleTime: 60_000, // 1 minute
    refetchOnWindowFocus: false,
  });
}
