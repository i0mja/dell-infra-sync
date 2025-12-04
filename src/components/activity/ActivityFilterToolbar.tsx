import { useState } from "react";
import { Search, Columns3, Download, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface ActivityFilterToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  activityTypeFilter: string;
  onActivityTypeChange: (value: string) => void;
  targetTypeFilter: string;
  onTargetTypeChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  timeRangeFilter: string;
  onTimeRangeChange: (value: string) => void;
  // Optional - for integrated toolbar
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
  onExport?: () => void;
  selectedCount?: number;
  onSaveView?: (name: string) => void;
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

const COLUMN_OPTIONS = [
  { key: "activity_type", label: "Activity Type" },
  { key: "target", label: "Target" },
  { key: "status", label: "Status" },
  { key: "duration", label: "Duration" },
  { key: "user", label: "User" },
  { key: "timestamp", label: "Time" },
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
  timeRangeFilter,
  onTimeRangeChange,
  visibleColumns,
  onToggleColumn,
  onExport,
  selectedCount = 0,
  onSaveView,
}: ActivityFilterToolbarProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");

  const handleSaveView = () => {
    if (viewName.trim() && onSaveView) {
      onSaveView(viewName);
      setSaveDialogOpen(false);
      setViewName("");
    }
  };

  const isColumnVisible = (key: string) => visibleColumns?.includes(key) ?? true;
  const showActions = visibleColumns && onToggleColumn && onExport && onSaveView;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/50">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search activities..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Select value={activityTypeFilter} onValueChange={onActivityTypeChange}>
          <SelectTrigger className="w-[180px] h-9">
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
          <SelectTrigger className="w-[140px] h-9">
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
          <SelectTrigger className="w-[130px] h-9">
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

        <Select value={timeRangeFilter} onValueChange={onTimeRangeChange}>
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

        {showActions && (
          <>
            <div className="flex-1" />

            {selectedCount > 0 && (
              <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns3 className="mr-1 h-4 w-4" /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUMN_OPTIONS.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={isColumnVisible(col.key)}
                    onCheckedChange={() => onToggleColumn?.(col.key)}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="mr-1 h-4 w-4" /> Export
            </Button>

            <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(true)}>
              <Save className="mr-1 h-4 w-4" /> Save View
            </Button>
          </>
        )}
      </div>

      {showActions && (
        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save View</DialogTitle>
              <DialogDescription>Save your current filters and column settings as a view</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="viewName">View Name</Label>
              <Input
                id="viewName"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g., Failed Activities This Week"
                className="mt-2"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveView}>Save View</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
