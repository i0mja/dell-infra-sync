import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Download,
  Columns3,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  Server,
  Activity,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";

interface Job {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  details: any;
  target_scope: any;
  created_by?: string;
  component_order?: number | null;
  totalTasks?: number;
  completedTasks?: number;
  runningTasks?: number;
  currentLog?: string | null;
  averageProgress?: number;
}

interface JobsTableProps {
  jobs: Job[];
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  jobTypeFilter: string;
  onJobTypeFilterChange: (value: string) => void;
  timeRangeFilter: string;
  onTimeRangeFilterChange: (value: string) => void;
  onJobClick: (job: Job) => void;
  expandedJobId: string | null;
}

export function JobsTable({
  jobs,
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  jobTypeFilter,
  onJobTypeFilterChange,
  timeRangeFilter,
  onTimeRangeFilterChange,
  onJobClick,
  expandedJobId,
}: JobsTableProps) {
  const [sortField, setSortField] = useState<string | null>("created_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { visibleColumns, isColumnVisible, toggleColumn } = useColumnVisibility(
    "jobs-table-columns",
    ["job_type", "status", "duration", "target", "started", "progress"]
  );

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

  const toggleJobSelection = (jobId: string) => {
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

  const handleExportCSV = () => {
    const columns: ExportColumn<Job>[] = [
      { key: "job_type", label: "Job Type" },
      { key: "status", label: "Status" },
      { key: "created_at", label: "Created" },
      { key: "started_at", label: "Started" },
      { key: "completed_at", label: "Completed" },
    ];

    const jobsToExport = selectedJobs.size > 0 ? jobs.filter((j) => selectedJobs.has(j.id)) : jobs;
    exportToCSV(jobsToExport, columns, "jobs");
    toast({ title: "Export successful", description: `Exported ${jobsToExport.length} jobs` });
  };

  // Apply sorting
  const sortedJobs = sortField
    ? [...jobs].sort((a, b) => {
        let aVal: any = a[sortField as keyof typeof a];
        let bVal: any = b[sortField as keyof typeof b];

        if (aVal == null) return 1;
        if (bVal == null) return -1;

        const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        return sortDirection === "asc" ? comparison : -comparison;
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

  const getStatusBadge = (status: string) => {
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
        return (
          <Badge variant="secondary" className="text-xs">
            Pending
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
    // vCenter sync jobs
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
    <div className="flex flex-col h-full border rounded-lg shadow-sm">
      {/* Unified Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap">
        <Checkbox
          checked={selectedJobs.size === jobs.length && jobs.length > 0}
          onCheckedChange={toggleAllJobs}
        />
        <span className="text-xs text-muted-foreground">
          {selectedJobs.size > 0 ? `${selectedJobs.size} selected` : "Select all"}
        </span>

        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search jobs..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>

        <Select value={jobTypeFilter} onValueChange={onJobTypeFilterChange}>
          <SelectTrigger className="w-[160px] h-8 text-sm">
            <SelectValue placeholder="Job Type" />
          </SelectTrigger>
            <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="discovery_scan">Initial Server Sync</SelectItem>
            <SelectItem value="vcenter_sync">vCenter Sync</SelectItem>
            <SelectItem value="scp_export">SCP Export</SelectItem>
            <SelectItem value="scp_import">SCP Import</SelectItem>
            <SelectItem value="firmware_update">Firmware Update</SelectItem>
            <SelectItem value="power_control">Power Control</SelectItem>
            <SelectItem value="console_launch">Console Launch</SelectItem>
            <SelectItem value="esxi_upgrade">ESXi Upgrade</SelectItem>
            <SelectItem value="esxi_preflight_check">ESXi Preflight</SelectItem>
          </SelectContent>
        </Select>

        <Select value={timeRangeFilter} onValueChange={onTimeRangeFilterChange}>
          <SelectTrigger className="w-[100px] h-8 text-sm">
            <SelectValue placeholder="Time" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">1 Hour</SelectItem>
            <SelectItem value="6h">6 Hours</SelectItem>
            <SelectItem value="24h">24 Hours</SelectItem>
            <SelectItem value="7d">7 Days</SelectItem>
            <SelectItem value="30d">30 Days</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8">
              <Columns3 className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("job_type")}
              onCheckedChange={() => toggleColumn("job_type")}
            >
              Job Type
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("status")}
              onCheckedChange={() => toggleColumn("status")}
            >
              Status
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("duration")}
              onCheckedChange={() => toggleColumn("duration")}
            >
              Duration
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("target")}
              onCheckedChange={() => toggleColumn("target")}
            >
              Target
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("started")}
              onCheckedChange={() => toggleColumn("started")}
            >
              Started
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("progress")}
              onCheckedChange={() => toggleColumn("progress")}
            >
              Progress
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="sm" className="h-8" onClick={handleExportCSV}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.paginatedItems.map((job) => (
              <TableRow
                key={job.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onJobClick(job)}
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
                {isColumnVisible("status") && <TableCell>{getStatusBadge(job.status)}</TableCell>}
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
                      job.details?.progress_percent !== undefined ? (
                        <div className="flex items-center gap-2">
                          <Progress value={job.details.progress_percent} className="w-24 h-2" />
                          <span className="text-xs text-muted-foreground">{job.details.progress_percent}%</span>
                        </div>
                      ) : job.averageProgress !== undefined ? (
                        <div className="flex items-center gap-2">
                          <Progress value={job.averageProgress} className="w-24 h-2" />
                          <span className="text-xs text-muted-foreground">{Math.round(job.averageProgress)}%</span>
                        </div>
                      ) : job.details?.current_step ? (
                        <span className="text-xs text-muted-foreground">{job.details.current_step}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
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
    </div>
  );
}
