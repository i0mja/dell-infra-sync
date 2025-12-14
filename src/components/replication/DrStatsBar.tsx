import { useEffect } from "react";
import { Shield, Target, Clock, Activity, HardDrive, CheckCircle2, AlertTriangle, Loader2, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useProtectionGroups, useReplicationTargets, useReplicationJobs } from "@/hooks/useReplication";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface StatItemProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  status?: 'success' | 'warning' | 'error' | 'neutral';
  loading?: boolean;
  animated?: boolean;
}

function StatItem({ icon: Icon, label, value, subValue, status = 'neutral', loading, animated }: StatItemProps) {
  const statusColors = {
    success: 'text-green-500',
    warning: 'text-amber-500',
    error: 'text-destructive',
    neutral: 'text-muted-foreground'
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 px-4 py-2">
        <Skeleton className="h-8 w-8 rounded" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-12" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className={`p-2 rounded-md bg-muted/50 ${statusColors[status]}`}>
        <Icon className={`h-4 w-4 ${animated ? 'animate-spin' : ''}`} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold">{value}</span>
          {subValue && (
            <span className="text-xs text-muted-foreground">{subValue}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function DrStatsBar() {
  const queryClient = useQueryClient();
  const { groups, loading: groupsLoading } = useProtectionGroups();
  const { targets, loading: targetsLoading } = useReplicationTargets();
  const { jobs, loading: jobsLoading } = useReplicationJobs();

  const loading = groupsLoading || targetsLoading || jobsLoading;

  // Real-time subscription for jobs table to update stats
  useEffect(() => {
    const channel = supabase
      .channel('dr-stats-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['replication-jobs'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'replication_targets' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['replication-targets'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'replication_jobs' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['replication-jobs'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Count active/running jobs for indicator
  const runningJobs = jobs.filter(j => 
    (j.status === 'running' || j.status === 'pending') && 
    j.job_type === 'run_replication_sync'
  ).length;

  // Calculate bytes being transferred in running jobs
  const activeTransferBytes = jobs
    .filter(j => j.status === 'running' && j.job_type === 'run_replication_sync')
    .reduce((sum, j) => {
      const jobDetails = j as any;
      return sum + (jobDetails.details?.bytes_transferred || 0);
    }, 0);

  // Calculate stats
  const totalVMs = groups.reduce((sum, g) => sum + (g.vm_count || 0), 0);
  const activeGroups = groups.filter(g => g.is_enabled).length;
  const healthyTargets = targets.filter(t => t.health_status === 'healthy').length;
  const degradedTargets = targets.filter(t => t.health_status === 'degraded' || t.health_status === 'offline').length;

  // Calculate RPO compliance using recent replication jobs per group
  const rpoCompliant = groups.filter(g => {
    if (!g.rpo_minutes || !g.is_enabled) return false;
    // Find the most recent completed replication job for this group
    const groupJobs = jobs.filter(j => 
      j.protection_group_id === g.id && 
      j.status === 'completed' &&
      j.job_type === 'run_replication_sync'
    );
    if (groupJobs.length === 0) return false;
    const lastJob = groupJobs[0]; // Already sorted by created_at desc
    if (!lastJob.completed_at) return false;
    const lastRep = new Date(lastJob.completed_at);
    const now = new Date();
    const minutesSince = (now.getTime() - lastRep.getTime()) / (1000 * 60);
    return minutesSince <= g.rpo_minutes;
  }).length;
  const enabledGroups = groups.filter(g => g.is_enabled);
  const rpoCompliance = enabledGroups.length > 0 ? Math.round((rpoCompliant / enabledGroups.length) * 100) : 0;

  // Last replication - find most recent completed sync job
  const recentSyncJobs = jobs.filter(j => j.status === 'completed' && j.job_type === 'run_replication_sync');
  const lastReplication = recentSyncJobs.length > 0 && recentSyncJobs[0].completed_at
    ? formatDistanceToNow(new Date(recentSyncJobs[0].completed_at), { addSuffix: true })
    : 'Never';
  
  // Calculate total bytes transferred from completed jobs
  const totalBytesTransferred = jobs
    .filter(j => j.status === 'completed')
    .reduce((sum, j) => sum + (j.bytes_transferred || 0), 0);

  // Get target health status
  const getTargetStatus = (): 'success' | 'warning' | 'error' | 'neutral' => {
    if (targets.length === 0) return 'neutral';
    if (degradedTargets > 0) return 'warning';
    if (healthyTargets === targets.length) return 'success';
    return 'neutral';
  };

  // Get RPO status
  const getRpoStatus = (): 'success' | 'warning' | 'error' | 'neutral' => {
    if (groups.length === 0) return 'neutral';
    if (rpoCompliance >= 90) return 'success';
    if (rpoCompliance >= 70) return 'warning';
    return 'error';
  };

  return (
    <div className="flex items-center border-b bg-muted/30 overflow-x-auto">
      <StatItem
        icon={Shield}
        label="Protected VMs"
        value={totalVMs}
        subValue={`${groups.length} groups`}
        status={totalVMs > 0 ? 'success' : 'neutral'}
        loading={loading}
      />
      <div className="h-8 w-px bg-border" />
      <StatItem
        icon={Activity}
        label="Active Groups"
        value={activeGroups}
        subValue={groups.length > activeGroups ? `${groups.length - activeGroups} paused` : 'all active'}
        status={activeGroups === groups.length && groups.length > 0 ? 'success' : 'neutral'}
        loading={loading}
      />
      <div className="h-8 w-px bg-border" />
      <StatItem
        icon={rpoCompliance >= 90 ? CheckCircle2 : AlertTriangle}
        label="RPO Compliance"
        value={`${rpoCompliance}%`}
        status={getRpoStatus()}
        loading={loading}
      />
      <div className="h-8 w-px bg-border" />
      <StatItem
        icon={Target}
        label="DR Targets"
        value={targets.length}
        subValue={healthyTargets > 0 ? `${healthyTargets} healthy` : undefined}
        status={getTargetStatus()}
        loading={loading}
      />
      <div className="h-8 w-px bg-border" />
      
      {/* Active Sync Indicator - show when jobs are running */}
      {runningJobs > 0 ? (
        <>
          <div className="flex items-center gap-3 px-4 py-2 bg-blue-500/10 border-l border-r border-blue-500/20">
            <div className="p-2 rounded-md bg-blue-500/20">
              <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
            </div>
            <div>
              <p className="text-xs text-blue-500 font-medium">Syncing Now</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-semibold text-blue-600">{runningJobs}</span>
                <span className="text-xs text-blue-500">
                  {activeTransferBytes > 0 ? `(${formatBytes(activeTransferBytes)})` : 'active'}
                </span>
              </div>
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
        </>
      ) : null}
      
      <StatItem
        icon={Clock}
        label="Last Replication"
        value={lastReplication}
        status="neutral"
        loading={loading}
      />
      <div className="h-8 w-px bg-border" />
      <StatItem
        icon={HardDrive}
        label="Data Transferred"
        value={formatBytes(totalBytesTransferred)}
        subValue="total"
        status={totalBytesTransferred > 0 ? 'success' : 'neutral'}
        loading={loading}
      />
      
      {/* Show current transfer rate if syncing */}
      {runningJobs > 0 && (
        <>
          <div className="h-8 w-px bg-border" />
          <div className="flex items-center gap-3 px-4 py-2">
            <div className="p-2 rounded-md bg-muted/50 text-blue-500">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Transfer Rate</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-semibold">
                  {getActiveTransferRate(jobs)} MB/s
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function getActiveTransferRate(jobs: any[]): string {
  const runningJobs = jobs.filter(j => j.status === 'running' && j.job_type === 'run_replication_sync');
  if (runningJobs.length === 0) return '0';
  
  const totalRate = runningJobs.reduce((sum, j) => {
    const rate = (j.details as any)?.transfer_rate_mbps || 0;
    return sum + rate;
  }, 0);
  
  return totalRate.toFixed(1);
}