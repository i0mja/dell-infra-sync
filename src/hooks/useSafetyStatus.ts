import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { startOfDay, endOfDay, format } from "date-fns";

interface ClusterSafetyDay {
  date: Date;
  clusters: { [key: string]: { safe: boolean; healthy: number; total: number } };
  serverGroups: { [key: string]: { safe: boolean; healthy: number; total: number } };
  maintenanceWindows: any[];
  allTargetsChecked: boolean;
  allTargetsSafe: boolean;
  hasWarnings: boolean;
}

export function useSafetyStatus(startDate: Date, endDate: Date) {
  const clusterChecks = useQuery({
    queryKey: ['cluster-safety-checks', format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cluster_safety_checks')
        .select('*')
        .gte('check_timestamp', startDate.toISOString())
        .lte('check_timestamp', endDate.toISOString())
        .order('check_timestamp', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  const groupChecks = useQuery({
    queryKey: ['server-group-safety-checks', format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('server_group_safety_checks')
        .select('*')
        .gte('check_timestamp', startDate.toISOString())
        .lte('check_timestamp', endDate.toISOString())
        .order('check_timestamp', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  const dailyStatus = useMemo(() => {
    const statusMap = new Map<string, ClusterSafetyDay>();
    
    // Process cluster checks
    for (const check of clusterChecks.data || []) {
      const dateKey = format(new Date(check.check_timestamp), 'yyyy-MM-dd');
      if (!statusMap.has(dateKey)) {
        statusMap.set(dateKey, {
          date: new Date(check.check_timestamp),
          clusters: {},
          serverGroups: {},
          maintenanceWindows: [],
          allTargetsChecked: false,
          allTargetsSafe: false,
          hasWarnings: false
        });
      }
      
      const dayData = statusMap.get(dateKey)!;
      if (!dayData.clusters[check.cluster_id]) {
        dayData.clusters[check.cluster_id] = {
          safe: check.safe_to_proceed,
          healthy: check.healthy_hosts,
          total: check.total_hosts
        };
      }
    }

    // Process server group checks
    for (const check of groupChecks.data || []) {
      const dateKey = format(new Date(check.check_timestamp), 'yyyy-MM-dd');
      if (!statusMap.has(dateKey)) {
        statusMap.set(dateKey, {
          date: new Date(check.check_timestamp),
          clusters: {},
          serverGroups: {},
          maintenanceWindows: [],
          allTargetsChecked: false,
          allTargetsSafe: false,
          hasWarnings: false
        });
      }
      
      const dayData = statusMap.get(dateKey)!;
      if (check.server_group_id && !dayData.serverGroups[check.server_group_id]) {
        dayData.serverGroups[check.server_group_id] = {
          safe: check.safe_to_proceed,
          healthy: check.healthy_servers,
          total: check.total_servers
        };
      }
    }

    // Calculate overall safety for each day
    for (const [, dayData] of statusMap) {
      const allClusters = Object.values(dayData.clusters);
      const allGroups = Object.values(dayData.serverGroups);
      const allTargets = [...allClusters, ...allGroups];
      
      dayData.allTargetsChecked = allTargets.length > 0;
      dayData.allTargetsSafe = allTargets.length > 0 && allTargets.every(t => t.safe);
      
      // Has warnings if some targets are unsafe but not all
      dayData.hasWarnings = allTargets.length > 0 && 
        !allTargets.every(t => t.safe) && 
        allTargets.some(t => t.safe);
    }

    return statusMap;
  }, [clusterChecks.data, groupChecks.data]);

  const chartData = useMemo(() => {
    const dates = Array.from(dailyStatus.keys()).sort();
    return dates.map(dateKey => {
      const dayData = dailyStatus.get(dateKey);
      const clusterNames = Object.keys(dayData?.clusters || {});
      
      const dataPoint: any = {
        date: dateKey,
        dateDisplay: format(new Date(dateKey), 'MMM dd')
      };

      for (const cluster of clusterNames) {
        dataPoint[cluster] = dayData?.clusters[cluster].safe ? 100 : 0;
      }

      return dataPoint;
    });
  }, [dailyStatus]);

  return {
    dailyStatus,
    chartData,
    isLoading: clusterChecks.isLoading || groupChecks.isLoading,
    refetch: () => {
      clusterChecks.refetch();
      groupChecks.refetch();
    }
  };
}
