import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  PlayCircle, 
  Calendar, 
  Zap,
  Filter,
  MoreHorizontal,
  FileText,
  RotateCcw,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Server,
  HardDrive
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

interface Operation {
  type: 'job' | 'maintenance';
  id: string;
  title: string;
  status: 'active' | 'planned' | 'completed' | 'failed';
  timestamp: Date;
  target: string;
  data: Job | MaintenanceWindow;
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
}

export function OperationsTable({ 
  operations,
  clusters,
  serverGroups,
  onRowClick, 
  onCancel,
  onRetry,
  onDelete,
  canManage 
}: OperationsTableProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [clusterFilter, setClusterFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "secondary",
      failed: "destructive",
      active: "default",
      planned: "outline",
    };
    return <Badge variant={variants[status] || "outline"}>{status.toUpperCase()}</Badge>;
  };

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const filteredOps = operations.filter(op => {
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

  return (
    <div className="flex flex-col flex-1 border rounded-lg bg-background overflow-hidden">
      <div className="border-b px-4 py-3 bg-muted/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-semibold">Operations & Maintenance</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            
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
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
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
                const isExpanded = expandedRows.has(op.id);
                const job = op.type === 'job' ? op.data as Job : null;
                const window = op.type === 'maintenance' ? op.data as MaintenanceWindow : null;

                return (
                  <Collapsible key={op.id} open={isExpanded} onOpenChange={() => toggleRow(op.id)} asChild>
                    <>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleRow(op.id)}>
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
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
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-1.5">
                            {job?.target_scope?.server_ids?.length > 0 && (
                              <>
                                <Server className="h-3 w-3 text-muted-foreground" />
                                <span>{job.target_scope.server_ids.length}</span>
                              </>
                            )}
                            {op.target}
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
                        <TableCell>
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
                      
                      {/* Expandable Details Row */}
                      <TableRow>
                        <TableCell colSpan={7} className="p-0 border-0">
                          <CollapsibleContent>
                            <div className="px-12 py-4 bg-muted/20 border-t">
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {/* Left: Timeline & Target Info */}
                                <div className="space-y-2">
                                  <div className="text-xs font-medium text-muted-foreground mb-1">Timeline</div>
                                  <div className="text-xs space-y-1">
                                    {job && (
                                      <>
                                        <div>Created: {format(new Date(job.created_at), 'MMM dd, HH:mm:ss')}</div>
                                        {job.started_at && (
                                          <div>Started: {format(new Date(job.started_at), 'MMM dd, HH:mm:ss')}</div>
                                        )}
                                        {job.completed_at && (
                                          <div>Completed: {format(new Date(job.completed_at), 'MMM dd, HH:mm:ss')}</div>
                                        )}
                                        {job.started_at && job.completed_at && (
                                          <div className="text-muted-foreground pt-1">
                                            Duration: {formatElapsed(job.started_at)}
                                          </div>
                                        )}
                                      </>
                                    )}
                                    {window && (
                                      <>
                                        <div>Planned: {format(new Date(window.planned_start), 'MMM dd, HH:mm')}</div>
                                        <div>End: {format(new Date(window.planned_end), 'MMM dd, HH:mm')}</div>
                                      </>
                                    )}
                                  </div>
                                  {job?.target_scope?.server_ids && (
                                    <div className="pt-2">
                                      <div className="text-xs font-medium text-muted-foreground mb-1">Targets</div>
                                      <div className="text-xs">
                                        {job.target_scope.server_ids.length} server{job.target_scope.server_ids.length !== 1 ? 's' : ''}
                                        {job.target_scope.cluster_name && (
                                          <span className="text-muted-foreground"> in {job.target_scope.cluster_name}</span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Middle: Status-specific details */}
                                <div className="space-y-2 lg:col-span-1">
                                  <div className="text-xs font-medium text-muted-foreground mb-1">Details</div>
                                  {job?.details?.error && (
                                    <div className="flex gap-2 text-destructive text-sm">
                                      <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                      <div>
                                        <span className="font-medium">Error: </span>
                                        {job.details.error}
                                      </div>
                                    </div>
                                  )}
                                  {job?.details?.current_step && job.status === 'running' && (
                                    <div className="flex gap-2 text-sm">
                                      <Loader2 className="h-4 w-4 mt-0.5 animate-spin flex-shrink-0 text-primary" />
                                      <span className="text-muted-foreground">{job.details.current_step}</span>
                                    </div>
                                  )}
                                  {job?.status === 'completed' && job.details?.results && (
                                    <div className="text-sm text-muted-foreground">
                                      {typeof job.details.results === 'string' 
                                        ? job.details.results 
                                        : JSON.stringify(job.details.results).substring(0, 200)}
                                    </div>
                                  )}
                                  {job?.status === 'pending' && job.details && (
                                    <div className="text-sm text-muted-foreground">
                                      {Object.entries(job.details)
                                        .filter(([key]) => !['current_step', 'error', 'results'].includes(key))
                                        .map(([key, value]) => (
                                          <div key={key}>
                                            {key}: {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                                          </div>
                                        ))}
                                    </div>
                                  )}
                                  {window && (
                                    <div className="space-y-1 text-sm text-muted-foreground">
                                      <div>Type: {window.maintenance_type}</div>
                                      {window.cluster_ids && window.cluster_ids.length > 0 && (
                                        <div>Clusters: {window.cluster_ids.join(', ')}</div>
                                      )}
                                      {window.server_group_ids && window.server_group_ids.length > 0 && (
                                        <div>Server Groups: {window.server_group_ids.length}</div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Right: Action buttons */}
                                <div className="flex flex-col gap-2 lg:items-end lg:justify-start">
                                  <Button 
                                    size="sm" 
                                    variant="outline" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRowClick(op);
                                    }}
                                  >
                                    <FileText className="h-4 w-4 mr-1" /> View Full Details
                                  </Button>
                                  {job?.status === 'failed' && onRetry && canManage && (
                                    <Button 
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onRetry(job);
                                      }}
                                    >
                                      <RotateCcw className="h-4 w-4 mr-1" /> Retry Job
                                    </Button>
                                  )}
                                  {job && ['pending', 'running'].includes(job.status) && onCancel && canManage && (
                                    <Button 
                                      size="sm" 
                                      variant="destructive"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onCancel(op.id);
                                      }}
                                    >
                                      <XCircle className="h-4 w-4 mr-1" /> Cancel Job
                                    </Button>
                                  )}
                                 </div>
                              </div>
                            </div>
                          </CollapsibleContent>
                        </TableCell>
                      </TableRow>
                    </>
                  </Collapsible>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
