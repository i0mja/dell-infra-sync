import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

export const ClusterSafetyWidget = () => {
  const { data: recentChecks } = useQuery({
    queryKey: ['recent-safety-checks'],
    queryFn: async () => {
      const { data } = await supabase
        .from('cluster_safety_checks')
        .select('*')
        .eq('is_scheduled', true)
        .order('check_timestamp', { ascending: false })
        .limit(10);
      return data || [];
    },
    refetchInterval: 300000 // Refresh every 5 minutes
  });

  // Get latest check for each unique cluster
  const latestChecks: Record<string, any> = {};
  recentChecks?.forEach(check => {
    if (!latestChecks[check.cluster_id]) {
      latestChecks[check.cluster_id] = check;
    }
  });

  const clustersArray = Object.values(latestChecks || {});
  const unsafeClusters = clustersArray.filter(c => !c.safe_to_proceed);
  const allSafe = unsafeClusters.length === 0 && clustersArray.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Cluster Safety Status
        </CardTitle>
        <CardDescription>
          Automated safety check results
        </CardDescription>
      </CardHeader>
      <CardContent>
        {clustersArray.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No scheduled checks configured yet
          </div>
        ) : allSafe ? (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">All clusters safe for maintenance</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">
                {unsafeClusters.length} cluster{unsafeClusters.length > 1 ? 's' : ''} unsafe
              </span>
            </div>
            {unsafeClusters.slice(0, 3).map(cluster => (
              <div key={cluster.id} className="p-3 bg-destructive/10 rounded-lg space-y-1">
                <p className="text-sm font-medium">{cluster.cluster_id}</p>
                <p className="text-xs text-muted-foreground">
                  {cluster.healthy_hosts}/{cluster.total_hosts} hosts healthy
                </p>
                {cluster.status_changed && (
                  <Badge variant="outline" className="text-xs">
                    Status changed
                  </Badge>
                )}
                <p className="text-xs text-muted-foreground">
                  Checked {formatDistanceToNow(new Date(cluster.check_timestamp), { addSuffix: true })}
                </p>
              </div>
            ))}
            {unsafeClusters.length > 3 && (
              <p className="text-xs text-muted-foreground">
                +{unsafeClusters.length - 3} more unsafe cluster{unsafeClusters.length - 3 > 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}
        
        <Button asChild variant="outline" className="w-full mt-4">
          <Link to="/vcenter">View All Clusters</Link>
        </Button>
      </CardContent>
    </Card>
  );
};
