import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface JobsFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  jobTypeFilter: string;
  onJobTypeFilterChange: (value: string) => void;
  timeRangeFilter: string;
  onTimeRangeFilterChange: (value: string) => void;
}

export function JobsFilterToolbar({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  jobTypeFilter,
  onJobTypeFilterChange,
  timeRangeFilter,
  onTimeRangeFilterChange,
}: JobsFilterToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search jobs..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
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
        <SelectTrigger className="w-[160px] h-9">
          <SelectValue placeholder="Job Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="discovery_scan">Discovery Scan</SelectItem>
          <SelectItem value="vcenter_sync">vCenter Sync</SelectItem>
          <SelectItem value="scp_export">SCP Export</SelectItem>
          <SelectItem value="scp_import">SCP Import</SelectItem>
          <SelectItem value="firmware_update">Firmware Update</SelectItem>
          <SelectItem value="power_control">Power Control</SelectItem>
          <SelectItem value="refresh_server_info">Refresh Server</SelectItem>
        </SelectContent>
      </Select>

      <Select value={timeRangeFilter} onValueChange={onTimeRangeFilterChange}>
        <SelectTrigger className="w-[120px] h-9">
          <SelectValue placeholder="Time" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1h">Last Hour</SelectItem>
          <SelectItem value="6h">Last 6 Hours</SelectItem>
          <SelectItem value="24h">Last 24 Hours</SelectItem>
          <SelectItem value="7d">Last 7 Days</SelectItem>
          <SelectItem value="30d">Last 30 Days</SelectItem>
          <SelectItem value="all">All Time</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
