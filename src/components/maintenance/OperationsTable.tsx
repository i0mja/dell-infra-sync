import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Loader2
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
  details?: {
    current_step?: string;
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
  onRowClick: (operation: Operation) => void;
  onCancel?: (jobId: string) => void;
  onRetry?: (job: Job) => void;
  onDelete?: (windowId: string) => void;
  canManage: boolean;
}

export function OperationsTable({ 
  operations, 
  onRowClick, 
  onCancel,
  onRetry,
  onDelete,
  canManage 
}: OperationsTableProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

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
    return true;
  });

  return (
    <div className="flex flex-col flex-1 border rounded-lg bg-background overflow-hidden">
      <div className="border-b px-4 py-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Operations & Maintenance</h3>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] h-8">
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
                <SelectTrigger className="w-[150px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="job">All Jobs</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="firmware_update">Firmware Update</SelectItem>
                  <SelectItem value="discovery_scan">Discovery</SelectItem>
                  <SelectItem value="vcenter_sync">vCenter Sync</SelectItem>
                  <SelectItem value="full_server_update">Full Server Update</SelectItem>
                  <SelectItem value="cluster_safety_check">Safety Check</SelectItem>
                </SelectContent>
              </Select>
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
              filteredOps.map((op) => (
                <TableRow 
                  key={op.id} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onRowClick(op)}
                >
                  <TableCell>
                    <div className={`w-1 h-8 rounded ${op.type === 'job' ? 'bg-blue-500' : 'bg-purple-500'}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {op.type === 'job' ? <Zap className="h-4 w-4 text-blue-500" /> : <Calendar className="h-4 w-4 text-purple-500" />}
                      <span className="font-medium">{op.title}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {op.type === 'job' ? 'Job' : 'Window'}
                  </TableCell>
                  <TableCell className="text-sm">{op.target}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      <span>{format(op.timestamp, 'MMM dd, HH:mm')}</span>
                      {op.type === 'job' && (op.data as Job).status === 'running' && (op.data as Job).started_at && (
                        <span className="text-xs text-muted-foreground">
                          ({formatElapsed((op.data as Job).started_at)} elapsed)
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(op.status)}
                        {getStatusBadge(op.status)}
                      </div>
                      {op.type === 'job' && (op.data as Job).status === 'running' && (
                        <JobProgressIndicator job={op.data as Job} />
                      )}
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
                          {op.type === 'job' && ['pending', 'running'].includes((op.data as Job).status) && onCancel && (
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
                          {op.type === 'job' && (op.data as Job).status === 'failed' && onRetry && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                onRetry(op.data as Job);
                              }}>
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Retry
                              </DropdownMenuItem>
                            </>
                          )}
                          {op.type === 'maintenance' && onDelete && (
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
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
