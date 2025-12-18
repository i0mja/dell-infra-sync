import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Activity, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Timer,
  Search,
  Loader2,
  Ban,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow, format, differenceInSeconds } from "date-fns";
import { Job } from "@/components/activity/JobsTable";
import { useMediaQuery } from "@/hooks/use-media-query";

interface JobHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobType: string;
  jobTypeLabel: string;
  jobs: Job[];
  onViewJob: (job: Job) => void;
}

export function JobHistoryDialog({
  open,
  onOpenChange,
  jobType,
  jobTypeLabel,
  jobs,
  onViewJob,
}: JobHistoryDialogProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Filter jobs for this type
  const typeJobs = useMemo(() => {
    return jobs
      .filter(j => j.job_type === jobType)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [jobs, jobType]);

  // Apply filters
  const filteredJobs = useMemo(() => {
    return typeJobs.filter(job => {
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const idMatch = job.id.toLowerCase().includes(search);
        const notesMatch = job.notes?.toLowerCase().includes(search);
        if (!idMatch && !notesMatch) return false;
      }
      return true;
    });
  }, [typeJobs, statusFilter, searchTerm]);

  // Calculate stats
  const stats = useMemo(() => {
    const successCount = typeJobs.filter(j => j.status === 'completed').length;
    const failureCount = typeJobs.filter(j => j.status === 'failed').length;
    const totalCompleted = successCount + failureCount;
    const successRate = totalCompleted > 0 ? (successCount / totalCompleted) * 100 : 0;
    
    // Calculate average duration
    const completedWithDuration = typeJobs.filter(
      j => j.status === 'completed' && j.started_at && j.completed_at
    );
    let avgDuration = 0;
    let maxDuration = 0;
    if (completedWithDuration.length > 0) {
      const durations = completedWithDuration.map(j => {
        const start = new Date(j.started_at!).getTime();
        const end = new Date(j.completed_at!).getTime();
        return end - start;
      });
      avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      maxDuration = Math.max(...durations);
    }
    
    return {
      total: typeJobs.length,
      successCount,
      failureCount,
      cancelledCount: typeJobs.filter(j => j.status === 'cancelled').length,
      pendingCount: typeJobs.filter(j => j.status === 'pending').length,
      runningCount: typeJobs.filter(j => j.status === 'running').length,
      successRate,
      avgDuration,
      maxDuration,
    };
  }, [typeJobs]);

  const formatDuration = (ms: number) => {
    if (ms === 0) return '—';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getJobDuration = (job: Job) => {
    if (!job.started_at) return '—';
    const start = new Date(job.started_at).getTime();
    const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
    return formatDuration(end - start);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="default" className="bg-success text-success-foreground text-xs gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="text-xs gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge variant="default" className="bg-primary text-primary-foreground text-xs gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary" className="text-xs gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
            <Ban className="h-3 w-3" />
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };

  const content = (
    <div className="flex flex-col h-full">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Runs</span>
            </div>
            <div className="text-2xl font-bold mt-1">{stats.total}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              <span className="text-sm text-muted-foreground">Success Rate</span>
            </div>
            <div className="text-2xl font-bold mt-1">
              {stats.successRate.toFixed(0)}%
            </div>
            <div className="text-xs text-muted-foreground">
              {stats.successCount} / {stats.successCount + stats.failureCount}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Avg Duration</span>
            </div>
            <div className="text-2xl font-bold mt-1">
              {formatDuration(stats.avgDuration)}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-muted-foreground">Failures</span>
            </div>
            <div className="text-2xl font-bold mt-1">{stats.failureCount}</div>
          </CardContent>
        </Card>
      </div>
      
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by job ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Jobs Table */}
      <ScrollArea className="flex-1 -mx-6 px-6">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[180px]">Started</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[100px]">Duration</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="w-[80px] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No jobs found matching filters
                </TableCell>
              </TableRow>
            ) : (
              filteredJobs.map((job) => (
                <TableRow 
                  key={job.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onViewJob(job)}
                >
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="text-sm">
                        {job.started_at 
                          ? format(new Date(job.started_at), 'MMM d, HH:mm:ss')
                          : format(new Date(job.created_at), 'MMM d, HH:mm:ss')
                        }
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(job.status)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {getJobDuration(job)}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                      {job.status === 'failed' && job.details?.error 
                        ? job.details.error 
                        : job.notes || `Job ${job.id.slice(0, 8)}...`
                      }
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {jobTypeLabel} - Run History
            </DialogTitle>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {jobTypeLabel} - Run History
          </SheetTitle>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
}
