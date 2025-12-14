import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Server, Clock, HardDrive, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface ActiveJob {
  id: string;
  job_type: string;
  status: string;
  started_at: string | null;
  details: {
    protection_group_id?: string;
    protection_group_name?: string;
    vm_name?: string;
    current_step?: string;
    progress_percent?: number;
    bytes_transferred?: number;
    current_vm?: string;
    vms_completed?: number;
    total_vms?: number;
  } | null;
}

export function ActiveReplicationsCard() {
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch active replication jobs
  const fetchActiveJobs = async () => {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, job_type, status, started_at, details')
      .in('job_type', ['run_replication_sync', 'storage_vmotion'])
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(10);

    if (!error && data) {
      setActiveJobs(data as ActiveJob[]);
    }
    setLoading(false);
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
          fetchActiveJobs();
        }
      )
      .subscribe();

    // Also poll every 3 seconds for progress updates
    const interval = setInterval(fetchActiveJobs, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

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
          <Badge variant="secondary" className="ml-auto">{activeJobs.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeJobs.map((job) => {
          const details = job.details || {};
          const progress = details.progress_percent || 0;
          const currentStep = details.current_step || (job.status === 'pending' ? 'Waiting...' : 'Processing...');
          const vmName = details.vm_name || details.current_vm;
          const groupName = details.protection_group_name;

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
                  <span className="text-muted-foreground">{currentStep}</span>
                  <span className="font-medium">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                {job.started_at && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Started {formatDistanceToNow(new Date(job.started_at), { addSuffix: true })}
                  </span>
                )}
                {details.bytes_transferred ? (
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatBytes(details.bytes_transferred)}
                  </span>
                ) : null}
              </div>

              {details.vms_completed !== undefined && details.total_vms !== undefined && (
                <p className="text-xs text-muted-foreground">
                  VMs: {details.vms_completed} / {details.total_vms}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
