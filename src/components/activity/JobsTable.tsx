import { useState } from "react";
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { compareValues } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Activity,
  MoreHorizontal,
  Eye,
  Copy,
  XCircle,
  RotateCcw,
  Trash2,
  Flag,
  AlertTriangle,
  Server,
  Clock,
  Timer,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow, differenceInSeconds, format, isPast } from "date-fns";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";

export interface Job {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  schedule_at: string | null;
  details: any;
  target_scope: any;
  created_by?: string;
  component_order?: number | null;
  priority?: string;
  notes?: string;
  totalTasks?: number;
  completedTasks?: number;
  runningTasks?: number;
  currentLog?: string | null;
  averageProgress?: number;
  calculatedProgress?: number | null;
}

interface JobsTableProps {
  jobs: Job[];
  onJobClick: (job: Job) => void;
  expandedJobId: string | null;
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
  onExport?: () => void;
  // Job management props
  onCancelJob?: (jobId: string) => Promise<void>;
  onRetryJob?: (job: Job) => Promise<void>;
  onDeleteJob?: (jobId: string) => Promise<void>;
  onBulkCancel?: (jobIds: string[]) => Promise<void>;
  onBulkDelete?: (jobIds: string[]) => Promise<void>;
  onViewDetails?: (job: Job) => void;
  onUpdatePriority?: (jobId: string, priority: string) => Promise<void>;
  canManage?: boolean;
}

const priorityConfig: Record<string, { label: string; color: string; icon: string }> = {
  critical: { label: "Critical", color: "bg-destructive text-destructive-foreground", icon: "🔴" },
  high: { label: "High", color: "bg-orange-500 text-white", icon: "🟠" },
  normal: { label: "Normal", color: "bg-secondary text-secondary-foreground", icon: "🟢" },
  low: { label: "Low", color: "bg-muted text-muted-foreground", icon: "⚪" },
};

export function JobsTable({
  jobs,
  onJobClick,
  expandedJobId,
  visibleColumns: propsVisibleColumns,
  onToggleColumn: propsOnToggleColumn,
  onExport: propsOnExport,
  onCancelJob,
  onRetryJob,
  onDeleteJob,
  onBulkCancel,
  onBulkDelete,
  onViewDetails,
  onUpdatePriority,
  canManage = false,
}: JobsTableProps) {
  const [sortField, setSortField] = useState<string | null>("created_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{ type: "cancel" | "delete" | "bulk-cancel" | "bulk-delete"; jobId?: string } | null>(null);
  const { toast } = useToast();

  const { visibleColumns: localVisibleColumns, isColumnVisible: localIsColumnVisible, toggleColumn: localToggleColumn } = useColumnVisibility(
    "jobs-table-columns",
    ["job_type", "status", "priority", "duration", "target", "started", "progress", "actions"]
  );

  const isColumnVisible = (col: string) => {
    if (propsVisibleColumns) {
      return propsVisibleColumns.includes(col);
    }
    return localIsColumnVisible(col);
  };

  const toggleColumn = (col: string) => {
    if (propsOnToggleColumn) {
      propsOnToggleColumn(col);
    } else {
      localToggleColumn(col);
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      if (sortDirection === "desc") {
        setSortField(null);
        setSortDirection("asc");
      } else {
        setSortDirection("desc");
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3" />;
    return sortDirection === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const toggleJobSelection = (jobId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newSelected = new Set(selectedJobs);
    if (newSelected.has(jobId)) {
      newSelected.delete(jobId);
    } else {
      newSelected.add(jobId);
    }
    setSelectedJobs(newSelected);
  };

  const toggleAllJobs = () => {
    if (selectedJobs.size === jobs.length) {
      setSelectedJobs(new Set());
    } else {
      setSelectedJobs(new Set(jobs.map((j) => j.id)));
    }
  };

  const handleCopyJobId = (jobId: string) => {
    navigator.clipboard.writeText(jobId);
    toast({ title: "Copied", description: "Job ID copied to clipboard" });
  };

  const handleExportCSV = () => {
    if (propsOnExport) {
      propsOnExport();
      return;
    }

    const columns: ExportColumn<Job>[] = [
      { key: "job_type", label: "Job Type" },
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority" },
      { key: "created_at", label: "Created" },
      { key: "started_at", label: "Started" },
      { key: "completed_at", label: "Completed" },
    ];

    const jobsToExport = selectedJobs.size > 0 ? jobs.filter((j) => selectedJobs.has(j.id)) : jobs;
    exportToCSV(jobsToExport, columns, "jobs");
    toast({ title: "Export successful", description: `Exported ${jobsToExport.length} jobs` });
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog) return;
    
    try {
      if (confirmDialog.type === "cancel" && confirmDialog.jobId && onCancelJob) {
        await onCancelJob(confirmDialog.jobId);
      } else if (confirmDialog.type === "delete" && confirmDialog.jobId && onDeleteJob) {
        await onDeleteJob(confirmDialog.jobId);
      } else if (confirmDialog.type === "bulk-cancel" && onBulkCancel) {
        await onBulkCancel(Array.from(selectedJobs));
        setSelectedJobs(new Set());
      } else if (confirmDialog.type === "bulk-delete" && onBulkDelete) {
        await onBulkDelete(Array.from(selectedJobs));
        setSelectedJobs(new Set());
      }
    } finally {
      setConfirmDialog(null);
    }
  };

  // Apply sorting
  const sortedJobs = sortField
    ? [...jobs].sort((a, b) => {
        const aVal = a[sortField as keyof typeof a];
        const bVal = b[sortField as keyof typeof b];
        return compareValues(aVal, bVal, sortDirection);
      })
    : jobs;

  // Apply pagination
  const pagination = usePagination(sortedJobs, "jobs-pagination", 50);

  const formatJobType = (type: string) => {
    return type
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  const getStatusBadge = (status: string, job?: Job) => {
    const stale = job && isJobStale(job);
    
    switch (status) {
      case "completed":
        return (
          <Badge variant="default" className="bg-success text-success-foreground text-xs">
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="text-xs">
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge variant="default" className="bg-primary text-primary-foreground text-xs">
            Running
          </Badge>
        );
      case "pending":
        const scheduled = job && isJobScheduled(job);
        const countdown = job && getScheduleCountdown(job);
        return (
          <div className="flex items-center gap-1">
            {scheduled ? (
              <Badge variant="outline" className="text-xs border-blue-500 text-blue-500 bg-blue-500/10">
                <Clock className="h-3 w-3 mr-1" />
                Scheduled {countdown && `(${countdown})`}
              </Badge>
            ) : (
              <>
                <Badge variant="secondary" className="text-xs">
                  Pending
                </Badge>
                {stale && (
                  <Badge variant="outline" className="text-xs border-amber-500 text-amber-500">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Not Picked Up
                  </Badge>
                )}
              </>
            )}
          </div>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Cancelled
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs">
            {status}
          </Badge>
        );
    }
  };

  const getPriorityBadge = (priority: string = "normal") => {
    const config = priorityConfig[priority] || priorityConfig.normal;
    return (
      <Badge variant="outline" className={`text-xs ${config.color}`}>
        {config.icon} {config.label}
      </Badge>
    );
  };

  const getDuration = (job: Job) => {
    if (!job.started_at) return "—";
    const start = new Date(job.started_at);
    const end = job.completed_at ? new Date(job.completed_at) : new Date();
    const diff = end.getTime() - start.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getTarget = (job: Job) => {
    // Handle cluster update jobs - show cluster name with host count
    if (job.job_type === 'rolling_cluster_update') {
      const clusterName = job.target_scope?.cluster_name || job.details?.workflow_results?.cluster_id;
      const hostCount = job.details?.workflow_results?.total_hosts || job.target_scope?.server_ids?.length;
      
      if (clusterName) {
        return (
          <div className="flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5 text-primary" />
            <Link 
              to={`/vcenter?cluster=${encodeURIComponent(clusterName)}`}
              className="font-medium text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {clusterName}
            </Link>
            {hostCount && (
              <span className="text-muted-foreground">({hostCount} hosts)</span>
            )}
          </div>
        );
      }
    }
    
    if (job.job_type === 'vcenter_sync') {
      const vmsTotal = job.details?.vms_total;
      const hostsTotal = job.details?.hosts_total;
      if (vmsTotal) return `${vmsTotal} VMs`;
      if (hostsTotal) return `${hostsTotal} hosts`;
      return 'vCenter';
    }
    
    if (job.target_scope?.server_ids?.length) {
      return `${job.target_scope.server_ids.length} ${job.target_scope.server_ids.length === 1 ? "server" : "servers"}`;
    }
    if (job.target_scope?.ip_ranges?.length) {
      const totalIPs = job.target_scope.ip_ranges.reduce((sum: number, range: string) => {
        const match = range.match(/\/(\d+)$/);
        if (match) {
          const cidr = parseInt(match[1]);
          return sum + Math.pow(2, 32 - cidr);
        }
        return sum + 1;
      }, 0);
      return `${totalIPs} IPs`;
    }
    if (job.details?.server_count) {
      return `${job.details.server_count} servers`;
    }
    return "—";
  };

  const canCancelJob = (job: Job) => ["pending", "running"].includes(job.status);
  const canRetryJob = (job: Job) => ["failed", "cancelled"].includes(job.status);
  const canDeleteJob = (job: Job) => ["completed", "failed", "cancelled"].includes(job.status);

  // Check if a job is scheduled for the future
  const isJobScheduled = (job: Job): boolean => {
    if (!job.schedule_at || job.status !== 'pending') return false;
    return !isPast(new Date(job.schedule_at));
  };

  // Get time until scheduled execution
  const getScheduleCountdown = (job: Job): string | null => {
    if (!job.schedule_at) return null;
    const scheduleDate = new Date(job.schedule_at);
    if (isPast(scheduleDate)) return null;
    const seconds = differenceInSeconds(scheduleDate, new Date());
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return format(scheduleDate, 'HH:mm');
  };

  // Check if a pending job is stale (not picked up after 60 seconds PAST its scheduled time)
  const isJobStale = (job: Job): boolean => {
    if (job.status !== 'pending' || job.started_at) return false;
    
    // If scheduled for future, not stale
    if (isJobScheduled(job)) return false;
    
    // Use schedule_at if present, otherwise created_at
    const referenceTime = job.schedule_at 
      ? new Date(job.schedule_at).getTime() 
      : new Date(job.created_at).getTime();
    
    const ageSeconds = (Date.now() - referenceTime) / 1000;
    return ageSeconds > 60;
  };

  const selectedCancellable = Array.from(selectedJobs).filter(id => {
    const job = jobs.find(j => j.id === id);
    return job && canCancelJob(job);
  });

  const selectedDeletable = Array.from(selectedJobs).filter(id => {
    const job = jobs.find(j => j.id === id);
    return job && canDeleteJob(job);
  });

  const renderJobActions = (job: Job) => (
    <>
      <DropdownMenuItem onClick={() => onViewDetails?.(job)}>
        <Eye className="mr-2 h-4 w-4" /> View Details
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => handleCopyJobId(job.id)}>
        <Copy className="mr-2 h-4 w-4" /> Copy Job ID
      </DropdownMenuItem>
      
      {canManage && onUpdatePriority && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Flag className="mr-2 h-4 w-4" /> Set Priority
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {Object.entries(priorityConfig).map(([key, config]) => (
                <DropdownMenuItem 
                  key={key} 
                  onClick={() => onUpdatePriority(job.id, key)}
                  className={job.priority === key ? "bg-accent" : ""}
                >
                  {config.icon} {config.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      )}

      {canManage && (
        <>
          <DropdownMenuSeparator />
          {canCancelJob(job) && onCancelJob && (
            <DropdownMenuItem onClick={() => setConfirmDialog({ type: "cancel", jobId: job.id })}>
              <XCircle className="mr-2 h-4 w-4" /> Cancel Job
            </DropdownMenuItem>
          )}
          {canRetryJob(job) && onRetryJob && (
            <DropdownMenuItem onClick={() => onRetryJob(job)}>
              <RotateCcw className="mr-2 h-4 w-4" /> Retry Job
            </DropdownMenuItem>
          )}
          {canDeleteJob(job) && onDeleteJob && (
            <DropdownMenuItem 
              className="text-destructive focus:text-destructive"
              onClick={() => setConfirmDialog({ type: "delete", jobId: job.id })}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete Job
            </DropdownMenuItem>
          )}
        </>
      )}
    </>
  );

  const renderContextMenuActions = (job: Job) => (
    <>
      <ContextMenuItem onClick={() => onViewDetails?.(job)}>
        <Eye className="mr-2 h-4 w-4" /> View Details
      </ContextMenuItem>
      <ContextMenuItem onClick={() => handleCopyJobId(job.id)}>
        <Copy className="mr-2 h-4 w-4" /> Copy Job ID
      </ContextMenuItem>
      
      {canManage && onUpdatePriority && (
        <>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Flag className="mr-2 h-4 w-4" /> Set Priority
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {Object.entries(priorityConfig).map(([key, config]) => (
                <ContextMenuItem 
                  key={key} 
                  onClick={() => onUpdatePriority(job.id, key)}
                  className={job.priority === key ? "bg-accent" : ""}
                >
                  {config.icon} {config.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}

      {canManage && (
        <>
          <ContextMenuSeparator />
          {canCancelJob(job) && onCancelJob && (
            <ContextMenuItem onClick={() => setConfirmDialog({ type: "cancel", jobId: job.id })}>
              <XCircle className="mr-2 h-4 w-4" /> Cancel Job
            </ContextMenuItem>
          )}
          {canRetryJob(job) && onRetryJob && (
            <ContextMenuItem onClick={() => onRetryJob(job)}>
              <RotateCcw className="mr-2 h-4 w-4" /> Retry Job
            </ContextMenuItem>
          )}
          {canDeleteJob(job) && onDeleteJob && (
            <ContextMenuItem 
              className="text-destructive focus:text-destructive"
              onClick={() => setConfirmDialog({ type: "delete", jobId: job.id })}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete Job
            </ContextMenuItem>
          )}
        </>
      )}
    </>
  );

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-12">
        <div className="text-center text-muted-foreground">
          <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium mb-2">No jobs found</p>
          <p className="text-sm mb-4">Jobs and operations will appear here once you start managing servers</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Bulk actions toolbar */}
      {selectedJobs.size > 0 && canManage && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 border-b">
          <span className="text-sm font-medium">{selectedJobs.size} selected</span>
          <Button size="sm" variant="ghost" onClick={toggleAllJobs}>
            {selectedJobs.size === jobs.length ? "Deselect All" : "Select All"}
          </Button>
          <div className="h-4 w-px bg-border" />
          {selectedCancellable.length > 0 && onBulkCancel && (
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => setConfirmDialog({ type: "bulk-cancel" })}
            >
              <XCircle className="h-4 w-4 mr-1" /> Cancel ({selectedCancellable.length})
            </Button>
          )}
          {selectedDeletable.length > 0 && onBulkDelete && (
            <Button 
              size="sm" 
              variant="ghost" 
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDialog({ type: "bulk-delete" })}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete ({selectedDeletable.length})
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox 
                  checked={selectedJobs.size === jobs.length && jobs.length > 0}
                  onCheckedChange={toggleAllJobs}
                />
              </TableHead>
              {isColumnVisible("job_type") && (
                <TableHead className="cursor-pointer" onClick={() => handleSort("job_type")}>
                  <div className="flex items-center">
                    Job Type
                    {getSortIcon("job_type")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("status") && (
                <TableHead className="cursor-pointer" onClick={() => handleSort("status")}>
                  <div className="flex items-center">
                    Status
                    {getSortIcon("status")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("priority") && (
                <TableHead className="cursor-pointer" onClick={() => handleSort("priority")}>
                  <div className="flex items-center">
                    Priority
                    {getSortIcon("priority")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("duration") && <TableHead>Duration</TableHead>}
              {isColumnVisible("target") && <TableHead>Target</TableHead>}
              {isColumnVisible("started") && (
                <TableHead className="cursor-pointer" onClick={() => handleSort("created_at")}>
                  <div className="flex items-center">
                    Started
                    {getSortIcon("created_at")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("progress") && <TableHead>Progress</TableHead>}
              {isColumnVisible("actions") && <TableHead className="w-12"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.paginatedItems.map((job) => (
              <ContextMenu key={job.id}>
                <ContextMenuTrigger asChild>
                  <TableRow
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onViewDetails ? onViewDetails(job) : onJobClick(job)}
                    data-state={expandedJobId === job.id ? "selected" : undefined}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedJobs.has(job.id)}
                        onCheckedChange={() => toggleJobSelection(job.id)}
                      />
                    </TableCell>
                    {isColumnVisible("job_type") && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Activity className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">{formatJobType(job.job_type)}</span>
                        </div>
                      </TableCell>
                    )}
                    {isColumnVisible("status") && <TableCell>{getStatusBadge(job.status, job)}</TableCell>}
                    {isColumnVisible("priority") && <TableCell>{getPriorityBadge(job.priority)}</TableCell>}
                    {isColumnVisible("duration") && (
                      <TableCell className="text-sm text-muted-foreground">{getDuration(job)}</TableCell>
                    )}
                    {isColumnVisible("target") && (
                      <TableCell className="text-sm text-muted-foreground">{getTarget(job)}</TableCell>
                    )}
                    {isColumnVisible("started") && (
                      <TableCell className="text-sm text-muted-foreground">
                        {job.started_at ? formatDistanceToNow(new Date(job.started_at), { addSuffix: true }) : "—"}
                      </TableCell>
                    )}
                    {isColumnVisible("progress") && (
                      <TableCell>
                        {job.status === "running" ? (
                          <div className="space-y-1">
                            {job.calculatedProgress !== undefined && job.calculatedProgress !== null ? (
                              <div className="flex items-center gap-2">
                                <Progress value={job.calculatedProgress} className="w-24 h-2" />
                                <span className="text-xs text-muted-foreground">{job.calculatedProgress}%</span>
                              </div>
                            ) : job.averageProgress !== undefined && job.averageProgress > 0 ? (
                              <div className="flex items-center gap-2">
                                <Progress value={job.averageProgress} className="w-24 h-2" />
                                <span className="text-xs text-muted-foreground">{Math.round(job.averageProgress)}%</span>
                              </div>
                            ) : job.details?.current_step ? (
                              <span className="text-xs text-muted-foreground truncate max-w-[150px] block">{job.details.current_step}</span>
                            ) : null}
                            {/* Show current host for cluster updates */}
                            {job.job_type === 'rolling_cluster_update' && job.details?.current_host && (
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                → {job.details.current_host}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    {isColumnVisible("actions") && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {renderJobActions(job)}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {renderContextMenuActions(job)}
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </TableBody>
        </Table>
      </div>
      
      <TablePagination
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        totalItems={sortedJobs.length}
        pageSize={pagination.pageSize}
        startIndex={pagination.startIndex}
        endIndex={pagination.endIndex}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        onFirstPage={pagination.goToFirstPage}
        onLastPage={pagination.goToLastPage}
        onNextPage={pagination.goToNextPage}
        onPrevPage={pagination.goToPrevPage}
        canGoNext={pagination.canGoNext}
        canGoPrev={pagination.canGoPrev}
      />

      {/* Confirmation dialogs */}
      <AlertDialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {confirmDialog?.type === "cancel" && "Cancel Job"}
              {confirmDialog?.type === "delete" && "Delete Job"}
              {confirmDialog?.type === "bulk-cancel" && `Cancel ${selectedCancellable.length} Jobs`}
              {confirmDialog?.type === "bulk-delete" && `Delete ${selectedDeletable.length} Jobs`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.type === "cancel" && "Are you sure you want to cancel this job? This action cannot be undone."}
              {confirmDialog?.type === "delete" && "Are you sure you want to delete this job? This will remove the job and its history permanently."}
              {confirmDialog?.type === "bulk-cancel" && `Are you sure you want to cancel ${selectedCancellable.length} jobs? This action cannot be undone.`}
              {confirmDialog?.type === "bulk-delete" && `Are you sure you want to delete ${selectedDeletable.length} jobs? This will remove them permanently.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmAction}
              className={confirmDialog?.type?.includes("delete") ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {confirmDialog?.type?.includes("cancel") ? "Yes, Cancel" : "Yes, Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}