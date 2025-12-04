import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "date-fns";
import { Calendar, Clock, User, CheckCircle, AlertCircle, Zap, ExternalLink, XCircle, PlayCircle, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getNextExecutionsFromConfig } from "@/lib/cron-utils";

interface OverviewTabProps {
  window: any;
  onUpdate?: () => void;
  onViewJob?: (jobId: string) => void;
}

export function OverviewTab({ window, onUpdate, onViewJob }: OverviewTabProps) {
  const { data: creator } = useQuery({
    queryKey: ['profile', window.created_by],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', window.created_by)
        .single();
      return data;
    }
  });

  const { data: approver } = useQuery({
    queryKey: ['profile', window.approved_by],
    queryFn: async () => {
      if (!window.approved_by) return null;
      const { data } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', window.approved_by)
        .single();
      return data;
    },
    enabled: !!window.approved_by
  });

  // Fetch linked jobs
  const { data: linkedJobs, isLoading: jobsLoading } = useQuery({
    queryKey: ['linked-jobs', window.id, window.job_ids],
    queryFn: async () => {
      if (!window.job_ids || window.job_ids.length === 0) return [];
      const { data, error } = await supabase
        .from('jobs')
        .select('id, job_type, status, created_at, started_at, completed_at, details')
        .in('id', window.job_ids)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!window.job_ids && window.job_ids.length > 0,
    refetchInterval: 5000 // Poll for status updates
  });

  const getNextRun = () => {
    if (window.status === 'completed' || window.status === 'failed') {
      return null;
    }

    if (window.recurrence_enabled && window.recurrence_pattern) {
      try {
        const recurrenceConfig = JSON.parse(window.recurrence_pattern);
        const nextRuns = getNextExecutionsFromConfig(recurrenceConfig, new Date(window.planned_start), 1);
        return nextRuns[0];
      } catch (error) {
        console.error('Error parsing recurrence pattern:', error);
      }
    }

    return new Date(window.planned_start);
  };

  const nextRun = getNextRun();
  const isUpcoming = nextRun && nextRun > new Date();

  const getJobStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4 text-success" />;
      case 'failed': return <XCircle className="h-4 w-4 text-destructive" />;
      case 'cancelled': return <XCircle className="h-4 w-4 text-muted-foreground" />;
      case 'running': return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'pending': return <Clock className="h-4 w-4 text-warning" />;
      default: return <PlayCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getJobStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "secondary",
      failed: "destructive",
      cancelled: "outline",
      running: "default",
      pending: "outline"
    };
    return <Badge variant={variants[status] || "outline"} className="capitalize">{status}</Badge>;
  };

  const formatJobType = (type: string) => {
    const labels: Record<string, string> = {
      rolling_cluster_update: "Cluster Update",
      firmware_update: "Firmware Update",
      esxi_upgrade: "ESXi Upgrade",
      esxi_then_firmware: "ESXi + Firmware",
      firmware_then_esxi: "Firmware + ESXi",
      cluster_safety_check: "Safety Check"
    };
    return labels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Get the most recent/active job
  const activeJob = linkedJobs?.find(j => j.status === 'running' || j.status === 'pending');
  const mostRecentJob = linkedJobs?.[0];
  const displayJob = activeJob || mostRecentJob;

  return (
    <div className="space-y-4">
      {/* Active/Recent Job Status Card - Prominent display */}
      {displayJob && (
        <Card className={displayJob.status === 'failed' ? 'border-destructive/50 bg-destructive/5' : 
                         displayJob.status === 'running' ? 'border-primary/50 bg-primary/5' : ''}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4" />
                {activeJob ? 'Active Job' : 'Latest Job'}
              </CardTitle>
              {getJobStatusBadge(displayJob.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getJobStatusIcon(displayJob.status)}
                <span className="font-medium">{formatJobType(displayJob.job_type)}</span>
              </div>
              {onViewJob && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => onViewJob(displayJob.id)}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  View Job
                </Button>
              )}
            </div>
            
            {displayJob.status === 'failed' && (displayJob.details as any)?.error && (
              <div className="p-2 bg-destructive/10 rounded border border-destructive/20 text-sm">
                <span className="font-medium text-destructive">Error: </span>
                <span className="text-destructive/80">{(displayJob.details as any).error}</span>
              </div>
            )}

            {displayJob.status === 'running' && (displayJob.details as any)?.current_step && (
              <div className="text-sm text-muted-foreground">
                Current step: {(displayJob.details as any).current_step}
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              {displayJob.started_at ? (
                <span>Started {formatDistanceToNow(new Date(displayJob.started_at), { addSuffix: true })}</span>
              ) : (
                <span>Created {formatDistanceToNow(new Date(displayJob.created_at), { addSuffix: true })}</span>
              )}
              {displayJob.completed_at && (
                <span> · Completed {formatDistanceToNow(new Date(displayJob.completed_at), { addSuffix: true })}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Linked Jobs (if more than one) */}
      {linkedJobs && linkedJobs.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">All Linked Jobs ({linkedJobs.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {linkedJobs.map(job => (
              <div 
                key={job.id}
                className="flex items-center justify-between p-2 rounded border hover:bg-muted/50 cursor-pointer"
                onClick={() => onViewJob?.(job.id)}
              >
                <div className="flex items-center gap-2">
                  {getJobStatusIcon(job.status)}
                  <span className="text-sm">{formatJobType(job.job_type)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(job.created_at), 'MMM dd, HH:mm')}
                  </span>
                  {getJobStatusBadge(job.status)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm text-muted-foreground mb-1">Type</div>
            <Badge variant="outline" className="capitalize">
              {window.maintenance_type.replace('_', ' ')}
            </Badge>
          </div>

          {window.description && (
            <div>
              <div className="text-sm text-muted-foreground mb-1">Description</div>
              <p className="text-sm">{window.description}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                <User className="w-3 h-3" />
                Created By
              </div>
              <p className="text-sm">
                {creator?.full_name || creator?.email || 'Unknown'}
              </p>
              <p className="text-xs text-muted-foreground">
                {format(new Date(window.created_at), 'PPp')}
              </p>
            </div>

            {window.requires_approval && window.approved_by && (
              <div>
                <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Approved By
                </div>
                <p className="text-sm">
                  {approver?.full_name || approver?.email || 'Unknown'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(window.approved_at), 'PPp')}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {window.auto_execute && (
              <Badge variant="outline" className="gap-1">
                <CheckCircle className="w-3 h-3" />
                Auto-Execute
              </Badge>
            )}
            {window.requires_approval && !window.approved_by && (
              <Badge variant="outline" className="gap-1 bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                <AlertCircle className="w-3 h-3" />
                Requires Approval
              </Badge>
            )}
            {window.notification_sent && (
              <Badge variant="outline">
                Notification Sent
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {isUpcoming && nextRun && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <div className="font-medium mb-1">Next Scheduled Run</div>
                <div className="text-2xl font-semibold mb-1">
                  {format(nextRun, 'PPp')}
                </div>
                <div className="text-sm text-muted-foreground">
                  Starts {formatDistanceToNow(nextRun, { addSuffix: true })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {window.last_executed_at && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last Execution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">
                {format(new Date(window.last_executed_at), 'PPp')}
              </span>
              <span className="text-sm text-muted-foreground">
                ({formatDistanceToNow(new Date(window.last_executed_at), { addSuffix: true })})
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {window.safety_check_snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Safety Check Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Total Hosts:</span>{' '}
              {window.safety_check_snapshot.total_hosts}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Healthy Hosts:</span>{' '}
              {window.safety_check_snapshot.healthy_hosts}
            </div>
            {window.safety_check_snapshot.drs_enabled !== undefined && (
              <div className="text-sm">
                <span className="text-muted-foreground">DRS:</span>{' '}
                {window.safety_check_snapshot.drs_enabled ? 'Enabled' : 'Disabled'}
              </div>
            )}
            {window.safety_check_snapshot.ha_enabled !== undefined && (
              <div className="text-sm">
                <span className="text-muted-foreground">HA:</span>{' '}
                {window.safety_check_snapshot.ha_enabled ? 'Enabled' : 'Disabled'}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}