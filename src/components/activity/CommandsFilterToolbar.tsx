import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface Server {
  id: string;
  hostname: string | null;
  ip_address: string;
}

interface CommandsFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  operationTypeFilter: string;
  onOperationTypeFilterChange: (value: string) => void;
  serverFilter: string;
  onServerFilterChange: (value: string) => void;
  commandTypeFilter: string;
  onCommandTypeFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  sourceFilter: string;
  onSourceFilterChange: (value: string) => void;
  timeRangeFilter: string;
  onTimeRangeFilterChange: (value: string) => void;
  servers: Server[];
}

export function CommandsFilterToolbar({
  searchTerm,
  onSearchChange,
  operationTypeFilter,
  onOperationTypeFilterChange,
  serverFilter,
  onServerFilterChange,
  commandTypeFilter,
  onCommandTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  sourceFilter,
  onSourceFilterChange,
  timeRangeFilter,
  onTimeRangeFilterChange,
  servers,
}: CommandsFilterToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30 flex-wrap">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search commands..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <Select value={operationTypeFilter} onValueChange={onOperationTypeFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Operation" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Operations</SelectItem>
          <SelectItem value="idrac_api">iDRAC API</SelectItem>
          <SelectItem value="vcenter_api">vCenter API</SelectItem>
          <SelectItem value="openmanage_api">OpenManage API</SelectItem>
        </SelectContent>
      </Select>

      <Select value={serverFilter} onValueChange={onServerFilterChange}>
        <SelectTrigger className="w-[160px] h-9">
          <SelectValue placeholder="Server" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Servers</SelectItem>
          {servers?.map((server) => (
            <SelectItem key={server.id} value={server.id}>
              {server.hostname || server.ip_address}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={commandTypeFilter} onValueChange={onCommandTypeFilterChange}>
        <SelectTrigger className="w-[120px] h-9">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="GET">GET</SelectItem>
          <SelectItem value="POST">POST</SelectItem>
          <SelectItem value="PATCH">PATCH</SelectItem>
          <SelectItem value="PUT">PUT</SelectItem>
          <SelectItem value="DELETE">DELETE</SelectItem>
        </SelectContent>
      </Select>

      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-[120px] h-9">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sourceFilter} onValueChange={onSourceFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          <SelectItem value="edge_function">Edge Function</SelectItem>
          <SelectItem value="job_executor">Job Executor</SelectItem>
          <SelectItem value="instant_api">Instant API</SelectItem>
          <SelectItem value="manual">Manual</SelectItem>
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
