import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Activity, 
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevronExpand,
  Filter,
  Server,
  HardDrive,
  AlertCircle
} from "lucide-react";
import { useReplicationJobs, EnrichedReplicationJob } from "@/hooks/useReplication";
import { formatDistanceToNow, format, isToday, isYesterday, startOfDay } from "date-fns";
import { JobDetailDialog } from "@/components/jobs/JobDetailDialog";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [10, 25, 50];

// Friendly labels for job types
const JOB_TYPE_LABELS: Record<string, string> = {
  'run_replication_sync': 'Replication Sync',
  'storage_vmotion': 'Storage vMotion',
  'scheduled': 'Scheduled',
  'manual': 'Manual',
  'initial_sync': 'Initial Sync',
  'failover_test': 'Failover Test',
};

export function ReplicationJobsPanel() {
  const { jobs, loading, refetch } = useReplicationJobs();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  
  // Dialog state
  const [selectedJob, setSelectedJob] = useState<EnrichedReplicationJob | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Get unique protection groups for filter
  const uniqueGroups = [...new Set(jobs.filter(j => j.group_name).map(j => j.group_name!))];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="outline" className="text-green-600 border-green-500/30 bg-green-500/10">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'running':
        return (
          <Badge variant="outline" className="text-blue-600 border-blue-500/30 bg-blue-500/10">
            <PlayCircle className="h-3 w-3 mr-1 animate-pulse" />
            Running
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-500/30 bg-amber-500/10">
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

  const getJobTypeLabel = (type: string) => {
    return JOB_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDuration = (startedAt: string | null, completedAt: string | null): string | null => {
    if (!startedAt) return null;
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Filter jobs
  const filteredJobs = jobs.filter(job => {
    if (statusFilter !== "all" && job.status !== statusFilter) return false;
    if (typeFilter !== "all" && job.job_type !== typeFilter) return false;
    if (groupFilter !== "all" && job.group_name !== groupFilter) return false;
    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filteredJobs.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedJobs = filteredJobs.slice(startIndex, startIndex + pageSize);

  // Group by date for timeline view
  const groupJobsByDate = (jobsToGroup: typeof jobs) => {
    const groups: { [key: string]: typeof jobs } = {};
    jobsToGroup.forEach(job => {
      const date = startOfDay(new Date(job.created_at));
      const key = date.toISOString();
      if (!groups[key]) groups[key] = [];
      groups[key].push(job);
    });
    return groups;
  };

  const groupedJobs = groupJobsByDate(paginatedJobs);

  const getDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMM d, yyyy");
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const handleRowClick = (job: EnrichedReplicationJob) => {
    // Convert to format expected by JobDetailDialog
    setSelectedJob(job);
    setDialogOpen(true);
  };

  // Convert EnrichedReplicationJob to Job format for dialog
  const getDialogJob = (job: EnrichedReplicationJob | null) => {
    if (!job) return null;
    return {
      id: job.id,
      job_type: job.job_type,
      status: job.status,
      target_scope: { protection_group_id: job.protection_group_id },
      details: job.details || {},
      created_at: job.created_at,
      started_at: job.started_at || null,
      completed_at: job.completed_at || null,
    };
  };

  const getStatusBorderColor = (status: string) => {
    switch (status) {
      case 'completed': return 'border-l-green-500';
      case 'running': return 'border-l-blue-500';
      case 'pending': return 'border-l-amber-500';
      case 'failed': return 'border-l-destructive';
      default: return 'border-l-muted';
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Activity History
              </CardTitle>
              <CardDescription>
                {filteredJobs.length} jobs total
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[130px] h-8">
                  <Filter className="h-3 w-3 mr-1" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              
              {/* Type Filter */}
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[160px] h-8">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="run_replication_sync">Replication Sync</SelectItem>
                  <SelectItem value="storage_vmotion">Storage vMotion</SelectItem>
                </SelectContent>
              </Select>

              {/* Group Filter */}
              {uniqueGroups.length > 0 && (
                <Select value={groupFilter} onValueChange={(v) => { setGroupFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger className="w-[160px] h-8">
                    <Server className="h-3 w-3 mr-1" />
                    <SelectValue placeholder="Group" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="all">All Groups</SelectItem>
                    {uniqueGroups.map(group => (
                      <SelectItem key={group} value={group}>{group}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              
              <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8">
                <RefreshCw className="h-3 w-3 mr-1" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No replication jobs</p>
              <p className="text-sm">
                {statusFilter !== "all" || typeFilter !== "all" || groupFilter !== "all"
                  ? "Try adjusting filters" 
                  : "Jobs will appear here when replication runs"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Timeline View */}
              <div className="space-y-4">
                {Object.entries(groupedJobs).map(([dateKey, dateJobs]) => (
                  <div key={dateKey}>
                    {/* Date Header */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-xs font-medium text-muted-foreground px-2">
                        {getDateLabel(dateKey)}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    
                    {/* Jobs for this date */}
                    <div className="space-y-1.5">
                      {dateJobs.map((job) => {
                        const duration = formatDuration(job.started_at || null, job.completed_at || null);
                        const isRunning = job.status === 'running';
                        const isFailed = job.status === 'failed';
                        const hasVmInfo = (job.vms_synced || 0) > 0 || (job.total_vms || 0) > 0;

                        return (
                          <div 
                            key={job.id} 
                            onClick={() => handleRowClick(job)}
                            className={cn(
                              "flex items-center gap-3 p-3 rounded-lg border-l-4 cursor-pointer transition-all",
                              "hover:bg-muted/50 hover:shadow-sm",
                              getStatusBorderColor(job.status),
                              isFailed && "bg-destructive/5",
                              isRunning && "bg-blue-500/5"
                            )}
                          >
                            {/* Time */}
                            <span className="text-xs text-muted-foreground w-12 flex-shrink-0 font-mono">
                              {format(new Date(job.created_at), 'HH:mm')}
                            </span>
                            
                            {/* Job Type & Group */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">
                                  {getJobTypeLabel(job.job_type)}
                                </span>
                                {job.group_name && (
                                  <Badge variant="outline" className="text-xs font-normal">
                                    <Server className="h-3 w-3 mr-1" />
                                    {job.group_name}
                                  </Badge>
                                )}
                              </div>
                              
                              {/* Progress bar for running jobs */}
                              {isRunning && job.current_step && (
                                <div className="mt-1.5 space-y-1">
                                  <p className="text-xs text-muted-foreground truncate">
                                    {job.current_step}
                                  </p>
                                  {job.progress_percent !== undefined && (
                                    <Progress value={job.progress_percent} className="h-1" />
                                  )}
                                </div>
                              )}

                              {/* Error message for failed jobs */}
                              {isFailed && job.error_message && (
                                <p className="text-xs text-destructive mt-1 truncate flex items-center gap-1">
                                  <AlertCircle className="h-3 w-3 flex-shrink-0" />
                                  {job.error_message}
                                </p>
                              )}
                            </div>
                            
                            {/* VM Count */}
                            {hasVmInfo && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground w-16 flex-shrink-0">
                                <HardDrive className="h-3 w-3" />
                                {job.vms_synced}/{job.total_vms} VMs
                              </div>
                            )}
                            
                            {/* Data Transferred */}
                            <div className="flex items-center gap-1 text-xs text-muted-foreground w-20 flex-shrink-0">
                              <ArrowRightLeft className="h-3 w-3" />
                              {formatBytes(job.bytes_transferred)}
                            </div>
                            
                            {/* Duration */}
                            <span className="text-xs text-muted-foreground w-16 flex-shrink-0 text-right">
                              {duration || (isRunning ? (
                                <span className="text-blue-600 animate-pulse">Running...</span>
                              ) : '-')}
                            </span>
                            
                            {/* Status */}
                            <div className="w-28 flex-shrink-0">
                              {getStatusBadge(job.status)}
                            </div>
                            
                            {/* Chevron indicator */}
                            <ChevronExpand className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Show</span>
                    <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                      <SelectTrigger className="w-[70px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover">
                        {PAGE_SIZES.map((size) => (
                          <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">per page</span>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm px-3">
                      {currentPage} of {totalPages}
                    </span>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job Detail Dialog */}
      <JobDetailDialog
        job={getDialogJob(selectedJob)}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
