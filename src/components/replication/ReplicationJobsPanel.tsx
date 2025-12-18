import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  Filter
} from "lucide-react";
import { useReplicationJobs } from "@/hooks/useReplication";
import { formatDistanceToNow, format, isToday, isYesterday, startOfDay } from "date-fns";

const PAGE_SIZES = [10, 25, 50];

export function ReplicationJobsPanel() {
  const { jobs, loading, refetch } = useReplicationJobs();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

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

  // Filter jobs
  const filteredJobs = jobs.filter(job => {
    if (statusFilter !== "all" && job.status !== statusFilter) return false;
    if (typeFilter !== "all" && job.job_type !== typeFilter) return false;
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

  return (
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
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="initial_sync">Initial Sync</SelectItem>
                <SelectItem value="failover_test">Failover Test</SelectItem>
              </SelectContent>
            </Select>
            
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
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No replication jobs</p>
            <p className="text-sm">
              {statusFilter !== "all" || typeFilter !== "all" 
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
                  <div className="space-y-1">
                    {dateJobs.map((job) => {
                      const startedAt = job.started_at ? new Date(job.started_at) : null;
                      const completedAt = job.completed_at ? new Date(job.completed_at) : null;
                      const duration = startedAt && completedAt 
                        ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
                        : null;

                      return (
                        <div 
                          key={job.id} 
                          className={`flex items-center gap-3 p-2 rounded-lg transition-colors hover:bg-muted/50 ${
                            job.status === 'failed' ? 'bg-destructive/5' : ''
                          }`}
                        >
                          {/* Time */}
                          <span className="text-xs text-muted-foreground w-12 flex-shrink-0">
                            {format(new Date(job.created_at), 'HH:mm')}
                          </span>
                          
                          {/* Type Badge */}
                          <div className="w-24 flex-shrink-0">
                            {getJobTypeBadge(job.job_type)}
                          </div>
                          
                          {/* Status */}
                          <div className="w-28 flex-shrink-0">
                            {getStatusBadge(job.status)}
                          </div>
                          
                          {/* Data Transferred */}
                          <div className="flex items-center gap-1.5 text-sm w-24 flex-shrink-0">
                            <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                            {formatBytes(job.bytes_transferred)}
                          </div>
                          
                          {/* Duration */}
                          <span className="text-sm text-muted-foreground w-16 flex-shrink-0">
                            {duration !== null ? (
                              duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m ${duration % 60}s`
                            ) : job.status === 'running' ? (
                              <span className="text-blue-600 animate-pulse">...</span>
                            ) : '-'}
                          </span>
                          
                          {/* Error message if failed */}
                          {job.error_message && (
                            <span className="text-xs text-destructive truncate flex-1" title={job.error_message}>
                              {job.error_message}
                            </span>
                          )}
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
  );
}
