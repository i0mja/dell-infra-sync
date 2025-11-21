import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  operationType: string;
  onOperationTypeChange: (value: string) => void;
  selectedServer: string;
  onServerChange: (value: string) => void;
  commandType: string;
  onCommandTypeChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  source: string;
  onSourceChange: (value: string) => void;
  timeRange: string;
  onTimeRangeChange: (value: string) => void;
  servers: Array<{ id: string; hostname: string | null; ip_address: string }>;
}

export const FilterToolbar = ({
  searchTerm,
  onSearchChange,
  operationType,
  onOperationTypeChange,
  selectedServer,
  onServerChange,
  commandType,
  onCommandTypeChange,
  status,
  onStatusChange,
  source,
  onSourceChange,
  timeRange,
  onTimeRangeChange,
  servers
}: FilterToolbarProps) => {
  return (
    <div className="border-b bg-muted/30 px-4 py-3 flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search commands..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9 bg-background"
        />
      </div>

      <Select value={operationType} onValueChange={onOperationTypeChange}>
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

      <Select value={selectedServer} onValueChange={onServerChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Server" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Servers</SelectItem>
          {servers.map((server) => (
            <SelectItem key={server.id} value={server.id}>
              {server.hostname || server.ip_address}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={commandType} onValueChange={onCommandTypeChange}>
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

      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[120px] h-9">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
        </SelectContent>
      </Select>

      <Select value={source} onValueChange={onSourceChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          <SelectItem value="edge_function">Edge Function</SelectItem>
          <SelectItem value="job_executor">Job Executor</SelectItem>
          <SelectItem value="manual">Manual</SelectItem>
        </SelectContent>
      </Select>

      <Select value={timeRange} onValueChange={onTimeRangeChange}>
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
};
