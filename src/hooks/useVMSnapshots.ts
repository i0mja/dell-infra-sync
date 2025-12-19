import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface VMSnapshot {
  id: string;
  vm_id: string;
  snapshot_id: string;
  name: string;
  description: string | null;
  created_at: string | null;
  size_bytes: number;
  is_current: boolean;
  parent_snapshot_id: string | null;
  source_vcenter_id: string | null;
  last_sync: string | null;
}

export function useVMSnapshots(vmId?: string) {
  return useQuery({
    queryKey: ['vm-snapshots', vmId],
    queryFn: async () => {
      if (!vmId) return [];
      
      const { data, error } = await supabase
        .from('vcenter_vm_snapshots')
        .select('*')
        .eq('vm_id', vmId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return (data || []) as VMSnapshot[];
    },
    enabled: !!vmId,
    staleTime: 5 * 60 * 1000,
  });
}
