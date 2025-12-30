import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { LayoutGrid, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ClusterInfo {
  id: string;
  name: string;
  vcenter_name: string;
  host_count: number;
  vm_count: number;
  ha_enabled: boolean;
  drs_enabled: boolean;
  cpu_usage: number;
  memory_usage: number;
  status: 'healthy' | 'warning' | 'critical';
}

export const ClusterTopologyMap = () => {
  const { data: clusters, isLoading } = useQuery({
    queryKey: ['cluster-topology'],
    queryFn: async () => {
      const { data: clusterData } = await supabase
        .from('vcenter_clusters')
        .select('*')
        .order('cluster_name');

      if (!clusterData) return [];

      // Get host counts per cluster
      const { data: hostCounts } = await supabase
        .from('vcenter_hosts')
        .select('cluster_id');

      const hostCountMap: Record<string, number> = {};
      hostCounts?.forEach(host => {
        if (host.cluster_id) {
          hostCountMap[host.cluster_id] = (hostCountMap[host.cluster_id] || 0) + 1;
        }
      });

      // Get vCenter names
      const vcenterIds = [...new Set(clusterData.map(c => c.vcenter_host_id).filter(Boolean))];
      const { data: vcenters } = await supabase
        .from('vcenter_hosts')
        .select('id, name')
        .in('id', vcenterIds as string[]);

      const vcenterMap: Record<string, string> = {};
      vcenters?.forEach(v => {
        vcenterMap[v.id] = v.name;
      });

      return clusterData.map(cluster => {
        const hostCount = hostCountMap[cluster.id] || 0;
        const cpuUsage = cluster.total_cpu_mhz && cluster.total_cpu_mhz > 0 
          ? Math.round(((cluster.used_cpu_mhz || 0) / cluster.total_cpu_mhz) * 100) 
          : 0;
        const memoryUsage = cluster.total_memory_mb && cluster.total_memory_mb > 0 
          ? Math.round(((cluster.used_memory_mb || 0) / cluster.total_memory_mb) * 100) 
          : 0;

        let status: 'healthy' | 'warning' | 'critical' = 'healthy';
        if (!cluster.ha_enabled || !cluster.drs_enabled) status = 'warning';
        if (cpuUsage > 85 || memoryUsage > 85) status = 'critical';
        else if (cpuUsage > 70 || memoryUsage > 70) status = 'warning';

        return {
          id: cluster.id,
          name: cluster.cluster_name || 'Unknown',
          vcenter_name: cluster.vcenter_host_id ? vcenterMap[cluster.vcenter_host_id] || 'Unknown' : 'Unknown',
          host_count: hostCount,
          vm_count: 0,
          ha_enabled: cluster.ha_enabled || false,
          drs_enabled: cluster.drs_enabled || false,
          cpu_usage: cpuUsage,
          memory_usage: memoryUsage,
          status,
        } as ClusterInfo;
      });
    }
  });

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutGrid className="h-4 w-4" />
            Cluster Topology
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusColors = {
    healthy: 'border-green-500/30 bg-green-500/5 hover:border-green-500/50',
    warning: 'border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50',
    critical: 'border-destructive/30 bg-destructive/5 hover:border-destructive/50',
  };

  const statusDot = {
    healthy: 'bg-green-500',
    warning: 'bg-amber-500',
    critical: 'bg-destructive',
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutGrid className="h-4 w-4" />
            Cluster Topology
          </CardTitle>
          <Link 
            to="/vcenter?tab=clusters" 
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            View all
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {clusters && clusters.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {clusters.slice(0, 6).map(cluster => (
              <Tooltip key={cluster.id}>
                <TooltipTrigger asChild>
                  <Link
                    to={`/vcenter?tab=clusters&cluster=${cluster.id}`}
                    className={cn(
                      "p-3 rounded-lg border transition-all",
                      statusColors[cluster.status]
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{cluster.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {cluster.vcenter_name}
                        </div>
                      </div>
                      <div className={cn("h-2 w-2 rounded-full shrink-0 mt-1", statusDot[cluster.status])} />
                    </div>
                    
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{cluster.host_count} hosts</span>
                      <span>{cluster.vm_count} VMs</span>
                    </div>

                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-8">CPU</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full rounded-full transition-all",
                              cluster.cpu_usage > 85 ? "bg-destructive" :
                              cluster.cpu_usage > 70 ? "bg-amber-500" : "bg-green-500"
                            )}
                            style={{ width: `${cluster.cpu_usage}%` }}
                          />
                        </div>
                        <span className="text-xs w-8 text-right">{cluster.cpu_usage}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-8">MEM</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full rounded-full transition-all",
                              cluster.memory_usage > 85 ? "bg-destructive" :
                              cluster.memory_usage > 70 ? "bg-amber-500" : "bg-green-500"
                            )}
                            style={{ width: `${cluster.memory_usage}%` }}
                          />
                        </div>
                        <span className="text-xs w-8 text-right">{cluster.memory_usage}%</span>
                      </div>
                    </div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div className="space-y-1">
                    <div>HA: {cluster.ha_enabled ? '✓ Enabled' : '✗ Disabled'}</div>
                    <div>DRS: {cluster.drs_enabled ? '✓ Enabled' : '✗ Disabled'}</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <LayoutGrid className="h-8 w-8 mx-auto mb-2 opacity-50" />
            No clusters found
          </div>
        )}
        {clusters && clusters.length > 6 && (
          <div className="mt-3 text-center">
            <Link 
              to="/vcenter?tab=clusters" 
              className="text-xs text-primary hover:underline"
            >
              +{clusters.length - 6} more clusters
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
