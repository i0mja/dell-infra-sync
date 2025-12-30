import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FleetHealthData {
  score: number;
  trend: 'up' | 'down' | 'stable';
  lastSyncAt: Date | null;
  metrics: {
    serverConnectivity: number;
    clusterHealth: number;
    alertScore: number;
    apiSuccessRate: number;
  };
  totals: {
    servers: { online: number; total: number };
    clusters: { healthy: number; total: number };
    vms: number;
    datastores: number;
    criticalAlerts: number;
  };
}

export const useFleetHealth = () => {
  return useQuery({
    queryKey: ['fleet-health-score'],
    queryFn: async (): Promise<FleetHealthData> => {
      // Fetch all metrics in parallel
      const [serversRes, clustersRes, vmsRes, datastoresRes, alertsRes, apiRes, lastSyncRes] = await Promise.all([
        supabase.from('servers').select('id, connection_status'),
        supabase.from('vcenter_clusters').select('id, ha_enabled, drs_enabled'),
        supabase.from('vcenter_vms').select('id', { count: 'exact', head: true }),
        supabase.from('vcenter_datastores').select('id', { count: 'exact', head: true }),
        supabase.from('server_event_logs')
          .select('id')
          .in('severity', ['Critical', 'Error'])
          .gte('timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        supabase.from('idrac_commands')
          .select('success')
          .gte('timestamp', new Date(Date.now() - 60 * 60 * 1000).toISOString()),
        supabase.from('jobs')
          .select('completed_at')
          .eq('job_type', 'vcenter_sync')
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(1)
      ]);

      const servers = serversRes.data || [];
      const clusters = clustersRes.data || [];
      const vmCount = vmsRes.count || 0;
      const datastoreCount = datastoresRes.count || 0;
      const criticalAlerts = alertsRes.data?.length || 0;
      const apiCalls = apiRes.data || [];

      // Calculate individual scores (0-100)
      const onlineServers = servers.filter(s => s.connection_status === 'online').length;
      const totalServers = servers.length;
      const serverConnectivity = totalServers > 0 ? (onlineServers / totalServers) * 100 : 100;

      const healthyClusters = clusters.filter(c => c.ha_enabled && c.drs_enabled).length;
      const totalClusters = clusters.length;
      const clusterHealth = totalClusters > 0 ? (healthyClusters / totalClusters) * 100 : 100;

      // Alert score: 100 = no alerts, decreases with more alerts
      const alertScore = Math.max(0, 100 - (criticalAlerts * 10));

      // API success rate
      const successfulCalls = apiCalls.filter(c => c.success).length;
      const apiSuccessRate = apiCalls.length > 0 ? (successfulCalls / apiCalls.length) * 100 : 100;

      // Weighted overall score
      const score = Math.round(
        (serverConnectivity * 0.35) +
        (clusterHealth * 0.25) +
        (alertScore * 0.20) +
        (apiSuccessRate * 0.20)
      );

      // Last sync time
      const lastSync = lastSyncRes.data?.[0]?.completed_at;
      const lastSyncAt = lastSync ? new Date(lastSync) : null;

      // Trend (placeholder - would need historical data)
      const trend: 'up' | 'down' | 'stable' = score >= 90 ? 'up' : score >= 70 ? 'stable' : 'down';

      return {
        score,
        trend,
        lastSyncAt,
        metrics: {
          serverConnectivity: Math.round(serverConnectivity),
          clusterHealth: Math.round(clusterHealth),
          alertScore: Math.round(alertScore),
          apiSuccessRate: Math.round(apiSuccessRate),
        },
        totals: {
          servers: { online: onlineServers, total: totalServers },
          clusters: { healthy: healthyClusters, total: totalClusters },
          vms: vmCount,
          datastores: datastoreCount,
          criticalAlerts,
        },
      };
    },
    refetchInterval: 30000,
  });
};
