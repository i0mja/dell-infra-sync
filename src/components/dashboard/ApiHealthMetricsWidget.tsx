import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

export const ApiHealthMetricsWidget = () => {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['idrac-api-metrics'],
    queryFn: async () => {
      const { data } = await supabase
        .from('idrac_commands')
        .select('success, response_time_ms, error_message')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (!data) return null;

      const total = data.length;
      const successful = data.filter(c => c.success).length;
      const failed = data.filter(c => !c.success).length;
      const successRate = total ? (successful / total) * 100 : 0;
      
      const responseTimes = data
        .filter(c => c.response_time_ms)
        .map(c => c.response_time_ms!);
      const avgLatency = responseTimes.length
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

      const recentErrors = data
        .filter(c => !c.success && c.error_message)
        .slice(0, 3)
        .map(c => c.error_message);

      return {
        total,
        successful,
        failed,
        successRate,
        avgLatency: Math.round(avgLatency),
        recentErrors
      };
    },
    refetchInterval: 60000 // Refresh every minute
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          API Health Metrics
        </CardTitle>
        <CardDescription>
          iDRAC API success rate and latency
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : metrics ? (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">Success Rate (last 100)</span>
                <span className="font-medium flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {metrics.successRate.toFixed(1)}%
                </span>
              </div>
              <Progress value={metrics.successRate} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg">
                <div className="text-sm text-muted-foreground">Successful</div>
                <div className="text-2xl font-bold">{metrics.successful}</div>
              </div>
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <div className="text-sm text-muted-foreground">Failed</div>
                <div className="text-2xl font-bold">{metrics.failed}</div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Zap className="h-3 w-3" />
                <span>Average Latency</span>
              </div>
              <div className="text-2xl font-bold">{metrics.avgLatency}ms</div>
            </div>

            {metrics.recentErrors.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Recent Errors</div>
                {metrics.recentErrors.map((error, idx) => (
                  <div key={idx} className="p-2 bg-destructive/10 rounded text-xs">
                    <div className="text-muted-foreground truncate">{error}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No API activity recorded yet
          </div>
        )}
      </CardContent>
    </Card>
  );
};
