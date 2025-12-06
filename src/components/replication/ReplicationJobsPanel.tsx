import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Activity, 
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  ArrowRightLeft
} from "lucide-react";
import { useReplicationJobs } from "@/hooks/useReplication";
import { formatDistanceToNow, format } from "date-fns";

export function ReplicationJobsPanel() {
  const { jobs, loading, refetch } = useReplicationJobs();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="outline" className="text-green-600 border-green-500/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'running':
        return (
          <Badge variant="outline" className="text-blue-600 border-blue-500/30">
            <PlayCircle className="h-3 w-3 mr-1 animate-pulse" />
            Running
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-500/30">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge variant="secondary">
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getJobTypeBadge = (type: string) => {
    switch (type) {
      case 'scheduled':
        return <Badge variant="outline">Scheduled</Badge>;
      case 'manual':
        return <Badge variant="outline" className="text-blue-600">Manual</Badge>;
      case 'initial_sync':
        return <Badge variant="outline" className="text-purple-600">Initial Sync</Badge>;
      case 'failover_test':
        return <Badge variant="outline" className="text-amber-600">Failover Test</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Replication Jobs
            </CardTitle>
            <CardDescription>
              Recent and running replication job history
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No replication jobs yet</p>
            <p className="text-sm">Jobs will appear here when replication runs</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data Transferred</TableHead>
                  <TableHead>Snapshot</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const startedAt = job.started_at ? new Date(job.started_at) : null;
                  const completedAt = job.completed_at ? new Date(job.completed_at) : null;
                  const duration = startedAt && completedAt 
                    ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
                    : null;

                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {startedAt 
                              ? format(startedAt, 'MMM d, HH:mm')
                              : format(new Date(job.created_at), 'MMM d, HH:mm')}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {getJobTypeBadge(job.job_type)}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(job.status)}
                        {job.error_message && (
                          <p className="text-xs text-destructive mt-1 max-w-xs truncate" title={job.error_message}>
                            {job.error_message}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                          {formatBytes(job.bytes_transferred)}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm font-mono">
                        {job.snapshot_name || '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {duration !== null ? (
                          <span>
                            {duration < 60 
                              ? `${duration}s` 
                              : `${Math.floor(duration / 60)}m ${duration % 60}s`}
                          </span>
                        ) : job.status === 'running' ? (
                          <span className="text-blue-600 animate-pulse">In progress...</span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
