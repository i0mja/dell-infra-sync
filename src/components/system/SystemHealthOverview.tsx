import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle, XCircle, Clock, Server, Key, Shield, Loader2 } from "lucide-react";
import { testJobExecutorConnection, getJobExecutorUrl } from "@/lib/job-executor-api";

interface HealthStatus {
  executorConnected: boolean | null;
  executorUrl: string;
  hmacConfigured: boolean | null;
  serviceKeyConfigured: boolean;
  recentJobsSuccess: number;
  recentJobsFailed: number;
  lastCleanup: string | null;
  isLoading: boolean;
}

export function SystemHealthOverview() {
  const [health, setHealth] = useState<HealthStatus>({
    executorConnected: null,
    executorUrl: getJobExecutorUrl(),
    hmacConfigured: null,
    serviceKeyConfigured: true, // Always true since it's in Supabase
    recentJobsSuccess: 0,
    recentJobsFailed: 0,
    lastCleanup: null,
    isLoading: true,
  });

  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    setHealth(prev => ({ ...prev, isLoading: true }));
    
    try {
      // Check executor connection
      const executorUrl = getJobExecutorUrl();
      const executorResult = await testJobExecutorConnection(executorUrl);
      
      // Check HMAC status
      let hmacConfigured = null;
      try {
        const { data } = await supabase.functions.invoke('set-executor-secret', {
          body: { action: 'check' }
        });
        hmacConfigured = data?.configured ?? false;
      } catch {
        hmacConfigured = false;
      }

      // Get recent job stats (last 24h)
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { count: successCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('completed_at', yesterday);

      const { count: failedCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('completed_at', yesterday);

      // Get last cleanup
      const { data: settings } = await supabase
        .from('activity_settings')
        .select('last_cleanup_at, job_last_cleanup_at')
        .maybeSingle();

      setHealth({
        executorConnected: executorResult.success,
        executorUrl,
        hmacConfigured,
        serviceKeyConfigured: true,
        recentJobsSuccess: successCount || 0,
        recentJobsFailed: failedCount || 0,
        lastCleanup: settings?.last_cleanup_at || settings?.job_last_cleanup_at || null,
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to check system health:', error);
      setHealth(prev => ({ ...prev, isLoading: false }));
    }
  };

  const StatusBadge = ({ ok, label }: { ok: boolean | null; label: string }) => {
    if (ok === null) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          {label}
        </Badge>
      );
    }
    return ok ? (
      <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30">
        <CheckCircle className="h-3 w-3" />
        {label}
      </Badge>
    ) : (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          System Health
        </CardTitle>
        <CardDescription>At-a-glance status of backend services</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Executor Status */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Server className="h-3.5 w-3.5" />
              Job Executor
            </div>
            <StatusBadge 
              ok={health.executorConnected} 
              label={health.executorConnected ? "Connected" : "Disconnected"} 
            />
          </div>

          {/* HMAC Status */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              HMAC Auth
            </div>
            <StatusBadge 
              ok={health.hmacConfigured} 
              label={health.hmacConfigured ? "Configured" : "Not Set"} 
            />
          </div>

          {/* Recent Jobs */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              Jobs (24h)
            </div>
            <div className="flex gap-1.5">
              {health.recentJobsSuccess > 0 && (
                <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30">
                  {health.recentJobsSuccess} OK
                </Badge>
              )}
              {health.recentJobsFailed > 0 && (
                <Badge variant="destructive" className="gap-1">
                  {health.recentJobsFailed} Failed
                </Badge>
              )}
              {health.recentJobsSuccess === 0 && health.recentJobsFailed === 0 && (
                <Badge variant="secondary">No jobs</Badge>
              )}
            </div>
          </div>

          {/* Last Cleanup */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Last Cleanup
            </div>
            <Badge variant="secondary">
              {health.lastCleanup 
                ? new Date(health.lastCleanup).toLocaleDateString()
                : "Never"
              }
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
