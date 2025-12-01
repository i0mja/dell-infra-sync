import { useState } from "react";
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { 
  CheckCircle,
  XCircle, 
  Clock, 
  PlayCircle, 
  Calendar, 
  Zap,
  MoreHorizontal,
  FileText,
  RotateCcw,
  Trash2,
  Loader2,
  Server,
  Sparkles,
  Search,
  Download,
  Columns3
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { useJobProgress, formatElapsed } from "@/hooks/useJobProgress";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  details?: {
    current_step?: string;
    error?: string;
    results?: any;
    [key: string]: any;
  };
}

function JobProgressIndicator({ job }: { job: Job }) {
  const { data: progress } = useJobProgress(
    job.id, 
    job.status === 'running' || job.status === 'pending'
  );
  
  if (!progress && job.status === 'running') {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">Processing...</span>
      </div>
    );
  }
  
  if (!progress) return null;
  
  return (
    <div className="flex items-center gap-2">
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
      <span className="text-xs text-muted-foreground">
        {progress.currentStep && progress.currentStep !== 'undefined' ? (
          <span className="max-w-[200px] truncate inline-block align-bottom">
            {progress.currentStep}
          </span>
        ) : progress.totalTasks > 0 ? (
          `${progress.completedTasks}/${progress.totalTasks} tasks`
        ) : (
          'Processing...'
        )}
      </span>
    </div>
  );
}

interface MaintenanceWindow {
  id: string;
  title: string;
  planned_start: string;
  planned_end: string;
  status: string;
  maintenance_type: string;
  cluster_ids: string[] | null;
  server_group_ids: string[] | null;
}

interface TargetMeta {
  type: 'server' | 'servers' | 'cluster' | 'groups' | 'none';
  serverIds?: string[];
  clusterName?: string;
  groupIds?: string[];
}

interface Operation {
  type: 'job' | 'maintenance';
  id: string;
  title: string;
  status: 'active' | 'planned' | 'completed' | 'failed';
  timestamp: Date;
  target: string;
  targetMeta?: TargetMeta;
  data: Job | MaintenanceWindow;
}

interface OptimalWindow {
  start: string;
  end: string;
  duration_hours: number;
  confidence: 'high' | 'medium' | 'low';
  affected_clusters: string[];
  all_clusters_safe: boolean;
}

interface OperationsTableProps {
  operations: Operation[];
  clusters: string[];
  serverGroups: Array<{ id: string; name: string }>;
  onRowClick: (operation: Operation) => void;
  onCancel?: (jobId: string) => void;
  onRetry?: (job: Job) => void;
  onDelete?: (windowId: string) => void;
  canManage: boolean;
  optimalWindow?: OptimalWindow | null;
  onScheduleOptimal?: () => void;
  onRunSafetyCheck?: () => void;
  onSyncVCenters?: () => void;
  onRunDiscovery?: () => void;
  onUpdateWizard?: () => void;
  onBulkCancel?: (jobIds: string[]) => void;
  onBulkDelete?: (operationIds: string[]) => void;
}

export function OperationsTable({ 
  operations,
  clusters,
  serverGroups,
  onRowClick, 
  onCancel,
  onRetry,
  onDelete,
  canManage,
  optimalWindow,
  onScheduleOptimal,
  onRunSafetyCheck,
  onSyncVCenters,
  onRunDiscovery,
  onUpdateWizard,
  onBulkCancel,
  onBulkDelete
}: OperationsTableProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [clusterFilter, setClusterFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set());
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4 text-success" />;
      case 'failed': return <XCircle className="h-4 w-4 text-destructive" />;
      case 'active': return <PlayCircle className="h-4 w-4 text-primary" />;
      case 'planned': return <Clock className="h-4 w-4 text-warning" />;
      default: return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-success text-success-foreground text-xs">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="text-xs">Failed</Badge>;
      case 'active':
        return <Badge className="bg-primary text-primary-foreground text-xs">Active</Badge>;
      case 'planned':
        return <Badge variant="outline" className="text-xs">Planned</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedOps);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedOps(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedOps.size === filteredOps.length) {
      setSelectedOps(new Set());
    } else {
      setSelectedOps(new Set(filteredOps.map(op => op.id)));
    }
  };

  const filteredOps = operations.filter(op => {
    // Search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const titleMatch = op.title.toLowerCase().includes(searchLower);
      const targetMatch = op.target.toLowerCase().includes(searchLower);
      if (!titleMatch && !targetMatch) return false;
    }

    if (statusFilter !== 'all' && op.status !== statusFilter) return false;
    
    if (typeFilter === 'maintenance') {
      return op.type === 'maintenance';
    }
    if (typeFilter === 'job') {
      return op.type === 'job';
    }
    if (typeFilter !== 'all') {
      if (op.type !== 'job') return false;
      const job = op.data as Job;
      if (job.job_type !== typeFilter) return false;
    }

    if (clusterFilter !== 'all') {
      if (op.type === 'maintenance') {
        const window = op.data as MaintenanceWindow;
        if (!window.cluster_ids?.includes(clusterFilter)) return false;
      } else {
        const job = op.data as Job;
        if (job.target_scope?.cluster_name !== clusterFilter) return false;
      }
    }

    if (dateRange !== 'all') {
      const now = new Date();
      const opDate = op.timestamp;
      const hoursDiff = (now.getTime() - opDate.getTime()) / (1000 * 60 * 60);
      
      if (dateRange === 'today' && hoursDiff > 24) return false;
      if (dateRange === 'week' && hoursDiff > 168) return false;
      if (dateRange === 'month' && hoursDiff > 720) return false;
    }

    return true;
  });

  const confidenceColors = {
    high: "text-success",
    medium: "text-warning",
    low: "text-muted-foreground"
  };

  return (
    <div className="flex flex-col h-full border rounded-lg shadow-sm bg-card overflow-hidden">
      {/* Optional Window Banner */}
      {optimalWindow && !bannerDismissed && (
        <div className="px-4 py-2 border-b bg-primary/5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="text-sm">
              <span className="font-semibold">Recommended:</span>{" "}
              {format(new Date(optimalWindow.start), "MMM dd, HH:mm")} - {format(new Date(optimalWindow.end), "HH:mm")}
              {" "}
              <span className={confidenceColors[optimalWindow.confidence]}>
                ({optimalWindow.confidence})
              </span>
              {" · "}
              {optimalWindow.all_clusters_safe ? (
                <span className="text-success">All safe</span>
              ) : (
                <span>{optimalWindow.affected_clusters.length} clusters</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" onClick={onScheduleOptimal}>
              <Calendar className="mr-2 h-4 w-4" />
              Schedule
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setBannerDismissed(true)}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Toolbar with Search + Filters */}
      <div className="border-b px-4 py-2 bg-card">
        <div className="flex flex-wrap items-center gap-2">
          {selectedOps.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">
                {selectedOps.size} selected
              </span>
              {onBulkCancel && (
                <Button variant="ghost" size="sm" className="h-8"
                  onClick={() => onBulkCancel(Array.from(selectedOps))}>
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Cancel ({selectedOps.size})
                </Button>
              )}
              {onBulkDelete && (
                <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive"
                  onClick={() => onBulkDelete(Array.from(selectedOps))}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete ({selectedOps.size})
                </Button>
              )}
            </>
          )}

          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search operations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 pl-8"
            />
          </div>
          
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[110px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[120px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="job">All Jobs</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="firmware_update">Firmware Update</SelectItem>
              <SelectItem value="discovery_scan">Discovery</SelectItem>
              <SelectItem value="vcenter_sync">vCenter Sync</SelectItem>
              <SelectItem value="full_server_update">Full Update</SelectItem>
              <SelectItem value="cluster_safety_check">Safety Check</SelectItem>
            </SelectContent>
          </Select>

          {clusters.length > 0 && (
            <Select value={clusterFilter} onValueChange={setClusterFilter}>
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue placeholder="All Clusters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clusters</SelectItem>
                {clusters.map(cluster => (
                  <SelectItem key={cluster} value={cluster}>{cluster}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex-1" />

          <Button variant="outline" size="sm" className="h-8 gap-2">
            <Columns3 className="h-4 w-4" />
            Columns
          </Button>

          <Button variant="outline" size="sm" className="h-8 gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={selectedOps.size === filteredOps.length && filteredOps.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOps.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No operations match the current filters
                </TableCell>
              </TableRow>
            ) : (
              filteredOps.map((op) => {
                const isSelected = selectedOps.has(op.id);
                const job = op.type === 'job' ? op.data as Job : null;
                const window = op.type === 'maintenance' ? op.data as MaintenanceWindow : null;

                return (
                  <ContextMenu key={op.id}>
                    <ContextMenuTrigger asChild>
                      <TableRow 
                        className="cursor-pointer hover:bg-muted/50" 
                        onClick={() => onRowClick(op)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelection(op.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {op.type === 'job' ? <Zap className="h-4 w-4 text-primary" /> : <Calendar className="h-4 w-4 text-purple-500" />}
                            <span className="font-medium">{op.title}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {op.type === 'job' ? 'Job' : 'Window'}
                        </TableCell>
                        <TableCell className="text-sm" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            {job?.target_scope?.server_ids?.length > 0 && (
                              <>
                                <Server className="h-3 w-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{job.target_scope.server_ids.length}</span>
                              </>
                            )}
                            {op.targetMeta?.type === 'server' && op.targetMeta.serverIds?.[0] ? (
                              <Link 
                                to={`/servers?server=${op.targetMeta.serverIds[0]}`}
                                className="text-primary hover:underline"
                              >
                                {op.target}
                              </Link>
                            ) : op.targetMeta?.type === 'servers' && op.targetMeta.serverIds?.length ? (
                              <Link 
                                to="/servers"
                                className="text-primary hover:underline"
                                title={`View ${op.targetMeta.serverIds.length} servers`}
                              >
                                {op.target}
                              </Link>
                            ) : op.targetMeta?.type === 'cluster' ? (
                              <Link 
                                to={`/vcenter?tab=clusters&cluster=${encodeURIComponent(op.targetMeta?.clusterName || '')}`}
                                className="text-primary hover:underline"
                              >
                                {op.target}
                              </Link>
                            ) : (
                              <span>{op.target}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="flex flex-col gap-0.5">
                            <span>{format(op.timestamp, 'MMM dd, HH:mm')}</span>
                            {job?.status === 'running' && job.started_at && (
                              <span className="text-xs">({formatElapsed(job.started_at)} elapsed)</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              {getStatusIcon(op.status)}
                              {getStatusBadge(op.status)}
                            </div>
                            {job?.status === 'running' && <JobProgressIndicator job={job} />}
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {canManage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => {
                                  e.stopPropagation();
                                  onRowClick(op);
                                }}>
                                  <FileText className="mr-2 h-4 w-4" />
                                  View Details
                                </DropdownMenuItem>
                                {job && ['pending', 'running'].includes(job.status) && onCancel && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onCancel(op.id);
                                      }}
                                      className="text-destructive"
                                    >
                                      <XCircle className="mr-2 h-4 w-4" />
                                      Cancel
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {job?.status === 'failed' && onRetry && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={(e) => {
                                      e.stopPropagation();
                                      onRetry(job);
                                    }}>
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      Retry
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {job && ['completed', 'failed', 'cancelled'].includes(job.status) && onBulkDelete && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onBulkDelete([op.id]);
                                      }}
                                      className="text-destructive"
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {window && onDelete && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete(op.id);
                                      }}
                                      className="text-destructive"
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => onRowClick(op)}>
                        <FileText className="mr-2 h-4 w-4" />
                        View Details
                      </ContextMenuItem>
                      {job && ['pending', 'running'].includes(job.status) && canManage && onCancel && (
                        <ContextMenuItem onClick={() => onCancel(op.id)}>
                          <XCircle className="mr-2 h-4 w-4" />
                          Cancel Job
                        </ContextMenuItem>
                      )}
                      {job?.status === 'failed' && canManage && onRetry && (
                        <ContextMenuItem onClick={() => onRetry(job)}>
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Retry Job
                        </ContextMenuItem>
                      )}
                      {job && ['completed', 'failed', 'cancelled'].includes(job.status) && canManage && onBulkDelete && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem 
                            className="text-destructive"
                            onClick={() => onBulkDelete([op.id])}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Job
                          </ContextMenuItem>
                        </>
                      )}
                      {window && canManage && onDelete && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem 
                            className="text-destructive"
                            onClick={() => onDelete(op.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Window
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
