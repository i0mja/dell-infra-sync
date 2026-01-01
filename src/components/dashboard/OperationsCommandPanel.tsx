import { useState } from "react";
import { 
  Activity, 
  Calendar, 
  History, 
  Play, 
  Pause, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Loader2,
  Server,
  Circle,
  ExternalLink
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { INTERNAL_JOB_TYPES, SLA_MONITORING_JOB_TYPES } from "@/lib/job-constants";

const HIDDEN_JOB_TYPES = [...INTERNAL_JOB_TYPES, ...SLA_MONITORING_JOB_TYPES];

const JOB_TYPE_LABELS: Record<string, string> = {
  cluster_rolling_update: 'Cluster Update',
  discovery_scan: 'Discovery Scan',
  vcenter_sync: 'vCenter Sync',
  scp_export: 'SCP Export',
  firmware_update: 'Firmware Update',
  power_control: 'Power Control',
  health_check: 'Health Check',
  esxi_upgrade: 'ESXi Upgrade',
  firmware_inventory_scan: 'Check for Updates',
};

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'pending':
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Activity className="h-4 w-4 text-muted-foreground" />;
  }
};

export const OperationsCommandPanel = () => {
  const [activeTab, setActiveTab] = useState("active");

  const { data: activeJobs, isLoading: activeLoading } = useQuery({
    queryKey: ['operations-active-jobs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, job_type, status, created_at, started_at, details, target_scope')
        .in('status', ['pending', 'running'])
        .is('parent_job_id', null)
        .not('job_type', 'in', `(${HIDDEN_JOB_TYPES.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    refetchInterval: 5000
  });

  const { data: scheduledWindows, isLoading: scheduledLoading } = useQuery({
    queryKey: ['operations-scheduled-windows'],
    queryFn: async () => {
      const { data } = await supabase
        .from('maintenance_windows')
        .select('id, title, maintenance_type, planned_start, status')
        .eq('status', 'planned')
        .gte('planned_start', new Date().toISOString())
        .order('planned_start', { ascending: true })
        .limit(5);
      return data || [];
    }
  });

  const { data: recentJobs, isLoading: recentLoading } = useQuery({
    queryKey: ['operations-recent-jobs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, job_type, status, completed_at, target_scope')
        .in('status', ['completed', 'failed'])
        .is('parent_job_id', null)
        .not('job_type', 'in', `(${HIDDEN_JOB_TYPES.join(',')})`)
        .order('completed_at', { ascending: false })
        .limit(8);
      return data || [];
    }
  });

  const { data: executorStatus } = useQuery({
    queryKey: ['executor-status-panel'],
    queryFn: async () => {
      const { data: heartbeat } = await supabase
        .from('executor_heartbeats')
        .select('last_seen_at, hostname, jobs_processed')
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .single();
      
      if (!heartbeat) return { status: 'offline', hostname: null };
      
      const lastSeen = new Date(heartbeat.last_seen_at);
      const isOnline = Date.now() - lastSeen.getTime() < 60000;
      
      return {
        status: isOnline ? 'online' : 'offline',
        hostname: heartbeat.hostname,
        jobsProcessed: heartbeat.jobs_processed
      };
    },
    refetchInterval: 15000
  });

  const runningCount = activeJobs?.filter(j => j.status === 'running').length || 0;
  const pendingCount = activeJobs?.filter(j => j.status === 'pending').length || 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Operations Command
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <Circle className={cn(
                "h-2 w-2 fill-current",
                executorStatus?.status === 'online' ? "text-green-500" : "text-muted-foreground"
              )} />
              <span className="text-muted-foreground">
                {executorStatus?.status === 'online' ? 'Executor Online' : 'Executor Offline'}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="active" className="relative">
              <Play className="h-3 w-3 mr-1" />
              Active
              {(runningCount + pendingCount) > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                  {runningCount + pendingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="scheduled">
              <Calendar className="h-3 w-3 mr-1" />
              Scheduled
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-3 w-3 mr-1" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-0 space-y-2">
            {activeLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : activeJobs && activeJobs.length > 0 ? (
              activeJobs.map(job => {
                const targetScope = job.target_scope as any;
                const clusterName = targetScope?.cluster_name || targetScope?.cluster_names?.[0];
                const progress = (job.details as any)?.progress || 0;
                
                return (
                  <Link
                    key={job.id}
                    to={`/activity?job=${job.id}`}
                    className="block p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusIcon status={job.status} />
                        <span className="font-medium text-sm truncate">
                          {JOB_TYPE_LABELS[job.job_type] || job.job_type}
                        </span>
                      </div>
                      <Badge variant={job.status === 'running' ? 'default' : 'secondary'} className="shrink-0">
                        {job.status}
                      </Badge>
                    </div>
                    {clusterName && (
                      <div className="text-xs text-muted-foreground mb-2">{clusterName}</div>
                    )}
                    {job.status === 'running' && (
                      <Progress value={progress} className="h-1.5" />
                    )}
                  </Link>
                );
              })
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Pause className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No active operations
              </div>
            )}
          </TabsContent>

          <TabsContent value="scheduled" className="mt-0 space-y-2">
            {scheduledLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : scheduledWindows && scheduledWindows.length > 0 ? (
              scheduledWindows.map(window => (
                <Link
                  key={window.id}
                  to={`/maintenance?window=${window.id}`}
                  className="block p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{window.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(window.planned_start), 'MMM d, HH:mm')} • 
                        {formatDistanceToNow(new Date(window.planned_start), { addSuffix: true })}
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {window.maintenance_type}
                    </Badge>
                  </div>
                </Link>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No scheduled maintenance
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-0 space-y-1">
            {recentLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : recentJobs && recentJobs.length > 0 ? (
              recentJobs.map(job => (
                <Link
                  key={job.id}
                  to={`/activity?job=${job.id}`}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <StatusIcon status={job.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">
                      {JOB_TYPE_LABELS[job.job_type] || job.job_type}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {job.completed_at && formatDistanceToNow(new Date(job.completed_at), { addSuffix: true })}
                  </span>
                </Link>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No recent history
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Button asChild variant="ghost" size="sm" className="w-full mt-3">
          <Link to="/activity">
            View All Operations
            <ExternalLink className="h-3 w-3 ml-2" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
};
