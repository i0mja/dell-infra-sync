import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Progress } from "@/components/ui/progress";

export const ClusterStatusSummary = () => {
  const [expanded, setExpanded] = useState(false);

  const { data: clusters } = useQuery({
    queryKey: ['vcenter-clusters'],
    queryFn: async () => {
      const { data } = await supabase.from('vcenter_clusters').select('*');
      return data || [];
    }
  });

  const { data: hosts } = useQuery({
    queryKey: ['vcenter-hosts-summary'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vcenter_hosts')
        .select('cluster, status');
      return data || [];
    }
  });

  const healthyClusters = clusters?.filter(c => c.ha_enabled && c.drs_enabled).length || 0;
  const totalClusters = clusters?.length || 0;
  const totalHosts = hosts?.length || 0;
  const haEnabled = clusters?.filter(c => c.ha_enabled).length || 0;
  const drsEnabled = clusters?.filter(c => c.drs_enabled).length || 0;

  const clusterStats = clusters?.map(cluster => {
    const clusterHosts = hosts?.filter(h => h.cluster === cluster.cluster_name) || [];
    const healthyHosts = clusterHosts.filter(h => 
      h.status === 'green' || h.status === 'Connected'
    ).length;
    const healthPercent = clusterHosts.length > 0 
      ? (healthyHosts / clusterHosts.length) * 100 
      : 0;
    
    return {
      ...cluster,
      totalHosts: clusterHosts.length,
      healthyHosts,
      healthPercent
    };
  }) || [];

  if (totalClusters === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No vCenter clusters configured yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-medium">
              vCenter Health: {healthyClusters}/{totalClusters} clusters healthy
            </div>
            <div className="text-xs text-muted-foreground">
              {totalHosts} hosts • HA: {haEnabled} • DRS: {drsEnabled}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-2 pt-2 border-t">
          {clusterStats.map(cluster => (
            <div key={cluster.id} className="p-3 bg-muted/30 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{cluster.cluster_name}</span>
                <div className="flex gap-1">
                  {cluster.ha_enabled && (
                    <Badge variant="secondary" className="text-xs">HA</Badge>
                  )}
                  {cluster.drs_enabled && (
                    <Badge variant="secondary" className="text-xs">DRS</Badge>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{cluster.healthyHosts}/{cluster.totalHosts} hosts healthy</span>
                  <span>{cluster.healthPercent.toFixed(0)}%</span>
                </div>
                <Progress value={cluster.healthPercent} className="h-1" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
