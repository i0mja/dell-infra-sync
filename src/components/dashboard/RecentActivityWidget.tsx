import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { INTERNAL_JOB_TYPES, SLA_MONITORING_JOB_TYPES } from "@/lib/job-constants";

// Combine all hidden job types for filtering
const HIDDEN_JOB_TYPES = [...INTERNAL_JOB_TYPES, ...SLA_MONITORING_JOB_TYPES];

const JOB_TYPE_LABELS: Record<string, string> = {
  discovery_scan: 'Discovery Scan',
  vcenter_sync: 'vCenter Sync',
  scp_export: 'SCP Export',
  scp_import: 'SCP Import',
  firmware_update: 'Firmware Update',
  power_control: 'Power Control',
  health_check: 'Health Check',
  bios_config: 'BIOS Config',
  virtual_media_mount: 'Virtual Media',
  cluster_safety_check: 'Safety Check',
  esxi_upgrade: 'ESXi Upgrade',
  credential_test: 'Credential Test',
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

export const RecentActivityWidget = () => {
  const { data: recentJobs, isLoading } = useQuery({
    queryKey: ['recent-dashboard-jobs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, job_type, status, created_at, completed_at, target_scope')
        .is('parent_job_id', null)
        .not('job_type', 'in', `(${HIDDEN_JOB_TYPES.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(6);
      return data || [];
    },
    refetchInterval: 10000
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {recentJobs && recentJobs.length > 0 ? (
          <>
            <div className="space-y-1">
              {recentJobs.map(job => {
                const targetScope = job.target_scope as any;
                const serverCount = targetScope?.server_ids?.length || 0;
                const targetLabel = serverCount > 1 ? `${serverCount} servers` : 
                  serverCount === 1 ? '1 server' : '';
                
                return (
                  <div
                    key={job.id}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors",
                      job.status === 'failed' && "bg-destructive/5"
                    )}
                  >
                    <StatusIcon status={job.status} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {JOB_TYPE_LABELS[job.job_type] || job.job_type}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {targetLabel && `${targetLabel} • `}
                        {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button asChild variant="ghost" size="sm" className="w-full mt-2">
              <Link to="/activity">View All Activity →</Link>
            </Button>
          </>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            No recent activity
          </div>
        )}
      </CardContent>
    </Card>
  );
};
