import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Server, Clock, HardDrive, Play, Zap, ArrowRight, CheckCircle2, AlertTriangle, Pause, RefreshCw, Database, GitBranch, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
interface VmSyncDetail {
  vm_name: string;
  bytes_transferred: number;
  expected_bytes?: number;
  transfer_rate_mbps: number;
  incremental_from?: string;
  site_b_verified?: boolean;
  success: boolean;
  // Enhanced snapshot stats
  snapshot_size?: number; // referenced bytes (total size)
  changes_since_last?: number; // used bytes (delta)
  is_incremental?: boolean;
}

interface JobDetails {
  protection_group_id?: string;
  protection_group_name?: string;
  vm_name?: string;
  current_step?: string;
  progress_percent?: number;
  bytes_transferred?: number;
  expected_bytes?: number;
  current_vm?: string;
  vms_completed?: number;
  total_vms?: number;
  transfer_rate_mbps?: number;
  site_b_verified?: boolean;
  vm_sync_details?: VmSyncDetail[];
  // Enhanced snapshot stats
  snapshot_size?: number;
  changes_since_last?: number;
  is_incremental?: boolean;
}

interface ActiveJob {
  id: string;
  job_type: string;
  status: string;
  started_at: string | null;
  details: JobDetails | null;
}

export function ActiveReplicationsCard() {
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch active replication jobs
  const fetchActiveJobs = async () => {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, job_type, status, started_at, details')
      .in('job_type', ['run_replication_sync', 'storage_vmotion', 'create_dr_shell'])
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(10);

    if (!error && data) {
      setActiveJobs(data as ActiveJob[]);
    }
    setLoading(false);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchActiveJobs();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const toggleLive = () => {
    setIsLive(prev => !prev);
  };

  useEffect(() => {
    fetchActiveJobs();

    // Subscribe to real-time updates for running jobs
    const channel = supabase
      .channel('active-replications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
          filter: 'status=in.(pending,running)'
        },
        () => {
          if (isLive) fetchActiveJobs();
        }
      )
      .subscribe();

    // Also poll every 2 seconds for progress updates when live
    if (isLive) {
      intervalRef.current = setInterval(fetchActiveJobs, 2000);
    }

    return () => {
      supabase.removeChannel(channel);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLive]);

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return "0 B";
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const getJobTypeBadge = (type: string) => {
    switch (type) {
      case 'run_replication_sync':
        return <Badge variant="outline" className="text-blue-600 border-blue-500/30">ZFS Sync</Badge>;
      case 'storage_vmotion':
        return <Badge variant="outline" className="text-purple-600 border-purple-500/30">vMotion</Badge>;
      case 'zfs_snapshot':
        return <Badge variant="outline" className="text-green-600 border-green-500/30">Snapshot</Badge>;
      case 'zfs_send':
        return <Badge variant="outline" className="text-amber-600 border-amber-500/30">ZFS Send</Badge>;
      case 'create_dr_shell':
        return <Badge variant="outline" className="text-teal-600 border-teal-500/30">DR Shell</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Play className="h-4 w-4" />
            Active Replications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (activeJobs.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Play className="h-4 w-4" />
            Active Replications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No active replication jobs
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Play className="h-4 w-4" />
          Active Replications
          <Badge variant="secondary" className="ml-2">{activeJobs.length}</Badge>
          
          <div className="ml-auto flex items-center gap-1">
            {/* Live indicator */}
            {isLive && (
              <div className="flex items-center gap-1 mr-1">
                <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] text-muted-foreground">Live</span>
              </div>
            )}
            
            {/* Live/Pause toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={toggleLive}
              title={isLive ? "Pause updates" : "Resume updates"}
            >
              {isLive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </Button>
            
            {/* Manual refresh */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh now"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeJobs.map((job) => {
          const details = job.details || {};
          const progress = details.progress_percent || 0;
          const currentStep = details.current_step || (job.status === 'pending' ? 'Waiting...' : 'Processing...');
          const vmName = details.vm_name || details.current_vm;
          const groupName = details.protection_group_name;
          const bytesTransferred = details.bytes_transferred || 0;
          const expectedBytes = details.expected_bytes || 0;
          const transferRate = details.transfer_rate_mbps || 0;
          const vmsCompleted = details.vms_completed || 0;
          const totalVms = details.total_vms || 0;
          const vmSyncDetails = details.vm_sync_details || [];
          const siteB_verified = details.site_b_verified;
          const snapshotSize = details.snapshot_size || 0;
          const changesSinceLast = details.changes_since_last || 0;
          const isIncremental = details.is_incremental ?? !!vmSyncDetails.some(v => v.is_incremental || v.incremental_from);

          return (
            <div key={job.id} className="space-y-2 p-3 rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getJobTypeBadge(job.job_type)}
                  {vmName && (
                    <span className="text-sm font-medium flex items-center gap-1">
                      <Server className="h-3 w-3" />
                      {vmName}
                    </span>
                  )}
                </div>
                {job.status === 'running' ? (
                  <Badge className="bg-blue-600">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Running
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <Clock className="h-3 w-3 mr-1" />
                    Pending
                  </Badge>
                )}
              </div>

              {groupName && (
                <p className="text-xs text-muted-foreground">
                  Protection Group: {groupName}
                </p>
              )}

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate max-w-[200px]">{currentStep}</span>
                  <span className="font-medium">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>

              {/* Enhanced Snapshot Stats Row */}
              <div className="flex items-center gap-4 text-xs">
                {/* Full vs Incremental Badge */}
                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${isIncremental ? 'bg-amber-500/10 text-amber-600' : 'bg-purple-500/10 text-purple-600'}`}>
                  {isIncremental ? (
                    <>
                      <GitBranch className="h-3 w-3" />
                      Incremental
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Full Sync
                    </>
                  )}
                </span>

                {/* Snapshot Size (referenced) */}
                {snapshotSize > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground" title="Total snapshot size (referenced bytes)">
                    <Database className="h-3 w-3" />
                    Size: {formatBytes(snapshotSize)}
                  </span>
                )}

                {/* Changes Since Last (used) */}
                {changesSinceLast >= 0 && isIncremental && (
                  <span className="flex items-center gap-1 text-cyan-600" title="Changes since last snapshot (used bytes)">
                    <ArrowRight className="h-3 w-3" />
                    Delta: {formatBytes(changesSinceLast)}
                  </span>
                )}
              </div>

              {/* Transfer Stats */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                  {job.started_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Started {formatDistanceToNow(new Date(job.started_at), { addSuffix: true })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {(bytesTransferred > 0 || expectedBytes > 0) && (
                    <span className="flex items-center gap-1 text-blue-600">
                      <HardDrive className="h-3 w-3" />
                      {formatBytes(bytesTransferred)}
                      {expectedBytes > 0 && expectedBytes !== bytesTransferred && (
                        <span className="text-muted-foreground">/ {formatBytes(expectedBytes)}</span>
                      )}
                    </span>
                  )}
                  {transferRate > 0 && (
                    <span className="flex items-center gap-1 text-green-600">
                      <Zap className="h-3 w-3" />
                      {transferRate.toFixed(1)} MB/s
                    </span>
                  )}
                  {siteB_verified && (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Verified
                    </span>
                  )}
                </div>
              </div>

              {/* VMs Progress */}
              {totalVms > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">VMs Progress</span>
                  <span className="font-medium">
                    {vmsCompleted} / {totalVms}
                  </span>
                </div>
              )}

              {/* Per-VM Sync Details */}
              {vmSyncDetails.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Completed VMs:</p>
                  {vmSyncDetails.slice(-3).map((vm, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs pl-2">
                      <span className="flex items-center gap-1">
                        {vm.site_b_verified ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        ) : vm.success ? (
                          <ArrowRight className="h-3 w-3 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-3 w-3 text-yellow-500" />
                        )}
                        {vm.vm_name}
                        {(vm.is_incremental || vm.incremental_from) && (
                          <span className="text-amber-500/80 text-[10px]">(incr)</span>
                        )}
                      </span>
                      <span className="text-muted-foreground flex items-center gap-2">
                        {/* Show snapshot size if available */}
                        {vm.snapshot_size && vm.snapshot_size > 0 && (
                          <span className="text-muted-foreground/60" title="Snapshot size">
                            {formatBytes(vm.snapshot_size)}
                          </span>
                        )}
                        {/* Show delta/transferred */}
                        <span className="text-blue-600">
                          {formatBytes(vm.bytes_transferred)}
                        </span>
                        {vm.transfer_rate_mbps > 0 && (
                          <span className="text-green-600">@ {vm.transfer_rate_mbps.toFixed(1)} MB/s</span>
                        )}
                      </span>
                    </div>
                  ))}
                  {vmSyncDetails.length > 3 && (
                    <p className="text-xs text-muted-foreground pl-2">
                      +{vmSyncDetails.length - 3} more...
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}