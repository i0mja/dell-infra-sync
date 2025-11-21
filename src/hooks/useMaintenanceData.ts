import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMaintenanceData() {
  const windows = useQuery({
    queryKey: ['maintenance-windows'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_windows')
        .select('*')
        .order('planned_start', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  const clusters = useQuery({
    queryKey: ['clusters'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vcenter_hosts')
        .select('cluster')
        .not('cluster', 'is', null);
      
      if (error) throw error;
      return [...new Set(data?.map(h => h.cluster).filter(Boolean) || [])];
    }
  });

  const serverGroups = useQuery({
    queryKey: ['server-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('server_groups')
        .select('id, name, description, color, icon')
        .order('name');
      
      if (error) throw error;
      return data || [];
    }
  });

  return {
    windows: windows.data || [],
    clusters: clusters.data || [],
    serverGroups: serverGroups.data || [],
    isLoading: windows.isLoading || clusters.isLoading || serverGroups.isLoading,
    refetch: () => {
      windows.refetch();
      clusters.refetch();
      serverGroups.refetch();
    }
  };
}
