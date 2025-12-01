import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Server } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

export const ClusterHealthWidget = () => {
  const { data: clusters } = useQuery({
    queryKey: ['vcenter-clusters'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vcenter_clusters')
        .select('*');
      return data || [];
    }
  });

  const { data: hosts } = useQuery({
    queryKey: ['vcenter-hosts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vcenter_hosts')
        .select('cluster, status');
      return data || [];
    }
  });

  const clusterStats = clusters?.map(cluster => {
    const clusterHosts = hosts?.filter(h => h.cluster === cluster.cluster_name) || [];
    const healthyHosts = clusterHosts.filter(h => 
      h.status === 'green' || h.status === 'Connected' || h.status === 'online'
    ).length;
    
    return {
      name: cluster.cluster_name,
      total: clusterHosts.length,
      healthy: healthyHosts,
      haEnabled: cluster.ha_enabled,
      drsEnabled: cluster.drs_enabled,
      healthPercent: clusterHosts.length ? (healthyHosts / clusterHosts.length) * 100 : 0
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          vCenter Cluster Health
        </CardTitle>
        <CardDescription>
          HA/DRS status and host distribution
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!clusters || !hosts ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : clusterStats && clusterStats.length > 0 ? (
          <div className="space-y-4">
            {clusterStats.map(cluster => (
              <div key={cluster.name} className="p-3 bg-muted/50 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{cluster.name}</span>
                  <div className="flex gap-1">
                    {cluster.haEnabled && (
                      <Badge variant="secondary" className="text-xs">HA</Badge>
                    )}
                    {cluster.drsEnabled && (
                      <Badge variant="secondary" className="text-xs">DRS</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Server className="h-3 w-3" />
                  <span>{cluster.healthy}/{cluster.total} hosts healthy</span>
                </div>
                <Progress value={cluster.healthPercent} />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No vCenter clusters configured yet
          </div>
        )}
      </CardContent>
    </Card>
  );
};
