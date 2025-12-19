import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface VMCustomAttribute {
  id: string;
  vm_id: string;
  attribute_key: string;
  attribute_value: string | null;
  source_vcenter_id: string | null;
  last_sync: string | null;
}

export function useVMCustomAttributes(vmId?: string) {
  return useQuery({
    queryKey: ['vm-custom-attributes', vmId],
    queryFn: async () => {
      if (!vmId) return [];
      
      const { data, error } = await supabase
        .from('vcenter_vm_custom_attributes')
        .select('*')
        .eq('vm_id', vmId)
        .order('attribute_key', { ascending: true });
      
      if (error) throw error;
      return (data || []) as VMCustomAttribute[];
    },
    enabled: !!vmId,
    staleTime: 5 * 60 * 1000,
  });
}
