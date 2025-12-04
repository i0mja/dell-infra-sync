import { Search, X, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ActivityFilterToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  activityTypeFilter: string;
  onActivityTypeChange: (value: string) => void;
  targetTypeFilter: string;
  onTargetTypeChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  onClearFilters: () => void;
}

const activityTypes = [
  { value: "all", label: "All Activities" },
  { value: "datastore_browse", label: "Datastore Browse" },
  { value: "connectivity_test", label: "Connectivity Test" },
  { value: "console_launch", label: "Console Launch" },
  { value: "health_check", label: "Health Check" },
  { value: "power_action", label: "Power Action" },
  { value: "virtual_media_mount", label: "Virtual Media Mount" },
  { value: "virtual_media_unmount", label: "Virtual Media Unmount" },
  { value: "event_log_fetch", label: "Event Log Fetch" },
  { value: "credential_test", label: "Credential Test" },
  { value: "idm_login", label: "IDM Login" },
  { value: "scp_preview", label: "SCP Preview" },
  { value: "bios_fetch", label: "BIOS Fetch" },
];

const targetTypes = [
  { value: "all", label: "All Targets" },
  { value: "server", label: "Server" },
  { value: "vcenter", label: "vCenter" },
  { value: "datastore", label: "Datastore" },
  { value: "idm", label: "IDM" },
  { value: "cluster", label: "Cluster" },
];

const statuses = [
  { value: "all", label: "All Statuses" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

export function ActivityFilterToolbar({
  searchQuery,
  onSearchChange,
  activityTypeFilter,
  onActivityTypeChange,
  targetTypeFilter,
  onTargetTypeChange,
  statusFilter,
  onStatusChange,
  onClearFilters,
}: ActivityFilterToolbarProps) {
  const hasActiveFilters =
    searchQuery ||
    activityTypeFilter !== "all" ||
    targetTypeFilter !== "all" ||
    statusFilter !== "all";

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search activities..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <Select value={activityTypeFilter} onValueChange={onActivityTypeChange}>
        <SelectTrigger className="w-[180px]">
          <Filter className="h-4 w-4 mr-2" />
          <SelectValue placeholder="Activity Type" />
        </SelectTrigger>
        <SelectContent>
          {activityTypes.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={targetTypeFilter} onValueChange={onTargetTypeChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Target Type" />
        </SelectTrigger>
        <SelectContent>
          {targetTypes.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={statusFilter} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((status) => (
            <SelectItem key={status.value} value={status.value}>
              {status.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
