import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Activity, CheckCircle2, Server, Circle, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const OperationsCard = () => {
  const { data: nextMaintenance, isLoading: maintenanceLoading } = useQuery({
    queryKey: ['next-maintenance'],
    queryFn: async () => {
      const { data } = await supabase
        .from('maintenance_windows')
        .select('*')
        .eq('status', 'planned')
        .gte('planned_start', new Date().toISOString())
        .order('planned_start', { ascending: true })
        .limit(1)
        .single();
      return data;
    }
  });

  const { data: activeJobs, isLoading: jobsLoading } = useQuery({
    queryKey: ['active-jobs-count'],
    queryFn: async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, status')
        .in('status', ['pending', 'running']);
      return data || [];
    },
    refetchInterval: 5000
  });

  const { data: apiMetrics, isLoading: apiLoading } = useQuery({
    queryKey: ['api-health-metrics'],
    queryFn: async () => {
      const { data } = await supabase
        .from('idrac_commands')
        .select('success, response_time_ms')
        .gte('timestamp', new Date(Date.now() - 60 * 60 * 1000).toISOString());
      
      if (!data || data.length === 0) return null;
      
      const successful = data.filter(d => d.success).length;
      const successRate = Math.round((successful / data.length) * 100);
      const avgLatency = Math.round(
        data.reduce((sum, d) => sum + (d.response_time_ms || 0), 0) / data.length
      );
      
      return { successRate, avgLatency, total: data.length };
    },
    refetchInterval: 60000
  });

  // Check for mixed content (HTTPS page trying to access HTTP API)
  const isMixedContent = (url: string | null) => {
    if (!url) return false;
    const isPageHttps = window.location.protocol === 'https:';
    const isApiHttp = url.startsWith('http://');
    return isPageHttps && isApiHttp;
  };

  // Job Executor status check
  const { data: executorStatus, isLoading: executorLoading } = useQuery({
    queryKey: ['job-executor-status'],
    queryFn: async () => {
      const { data: settings } = await supabase
        .from('activity_settings')
        .select('job_executor_url')
        .single();
      
      if (!settings?.job_executor_url) {
        return { status: 'not_configured', url: null, mixedContent: false };
      }

      // Check for mixed content scenario
      const mixedContent = isMixedContent(settings.job_executor_url);
      if (mixedContent) {
        return { status: 'mixed_content', url: settings.job_executor_url, mixedContent: true };
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${settings.job_executor_url}/api/health`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (response.ok) {
          return { status: 'online', url: settings.job_executor_url, mixedContent: false };
        }
        return { status: 'offline', url: settings.job_executor_url, mixedContent: false };
      } catch {
        return { status: 'offline', url: settings.job_executor_url, mixedContent: false };
      }
    },
    refetchInterval: 30000
  });

  const isLoading = maintenanceLoading || jobsLoading || apiLoading || executorLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Operations</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Next Maintenance */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Calendar className="h-4 w-4 text-primary" />
            Next Maintenance
          </div>
          {nextMaintenance ? (
            <div className="p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{nextMaintenance.title}</span>
                <Badge variant="secondary" className="text-xs">{nextMaintenance.maintenance_type}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(nextMaintenance.planned_start), 'MMM d, HH:mm')} • 
                {formatDistanceToNow(new Date(nextMaintenance.planned_start), { addSuffix: true })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No upcoming maintenance</div>
          )}
        </div>

        {/* Active Jobs */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-primary" />
            Active Jobs
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold">
              {activeJobs?.length || 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {activeJobs?.filter(j => j.status === 'running').length || 0} running, 
              {activeJobs?.filter(j => j.status === 'pending').length || 0} pending
            </div>
          </div>
        </div>

        {/* Job Executor Status */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Server className="h-4 w-4 text-primary" />
            Job Executor
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2">
              <Circle 
                className={cn(
                  "h-3 w-3 fill-current",
                  executorStatus?.status === 'online' && "text-green-500",
                  executorStatus?.status === 'offline' && "text-destructive",
                  executorStatus?.status === 'not_configured' && "text-muted-foreground",
                  executorStatus?.status === 'mixed_content' && "text-yellow-500"
                )} 
              />
              <span className="text-sm font-medium capitalize">
                {executorStatus?.status === 'not_configured' ? 'Not Configured' : 
                 executorStatus?.status === 'mixed_content' ? 'Job Queue Mode' : 
                 executorStatus?.status}
              </span>
            </div>
            {executorStatus?.status === 'not_configured' && (
              <p className="text-xs text-muted-foreground mt-1">
                Configure in Settings → System → Job Executor
              </p>
            )}
          </div>
          {executorStatus?.status === 'mixed_content' && (
            <Alert className="border-yellow-500/50 bg-yellow-500/10">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <AlertDescription className="text-xs">
                <strong>Mixed Content:</strong> This HTTPS page cannot directly access the HTTP Job Executor. 
                Operations will use the job queue instead (slightly slower but works reliably).
                <Link to="/settings?tab=system&section=job-executor" className="block mt-1 text-primary hover:underline">
                  Configure HTTPS on Job Executor →
                </Link>
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* API Health */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            API Health (last hour)
          </div>
          {apiMetrics ? (
            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Success Rate</span>
                  <span className="font-medium">{apiMetrics.successRate}%</span>
                </div>
                <Progress value={apiMetrics.successRate} className="h-1" />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 bg-muted/30 rounded">
                  <div className="text-muted-foreground">Avg Latency</div>
                  <div className="font-medium">{apiMetrics.avgLatency}ms</div>
                </div>
                <div className="p-2 bg-muted/30 rounded">
                  <div className="text-muted-foreground">Total Calls</div>
                  <div className="font-medium">{apiMetrics.total}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No API activity</div>
          )}
        </div>

        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to="/activity">View Activity Details</Link>
        </Button>
      </CardContent>
    </Card>
  );
};
