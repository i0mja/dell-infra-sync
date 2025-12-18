import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Search, Columns3, Download, Save, List, LayoutGrid } from "lucide-react";

export type JobsViewMode = "list" | "summary";

interface JobsFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  jobTypeFilter: string;
  onJobTypeFilterChange: (value: string) => void;
  timeRangeFilter: string;
  onTimeRangeFilterChange: (value: string) => void;
  // View mode toggle
  viewMode?: JobsViewMode;
  onViewModeChange?: (mode: JobsViewMode) => void;
  // Optional - for integrated toolbar
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
  onExport?: () => void;
  selectedCount?: number;
  onSaveView?: (name: string) => void;
}

const COLUMN_OPTIONS = [
  { key: "job_type", label: "Job Type" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "duration", label: "Duration" },
  { key: "target", label: "Target" },
  { key: "started", label: "Started" },
  { key: "progress", label: "Progress" },
  { key: "actions", label: "Actions" },
];

export function JobsFilterToolbar({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  jobTypeFilter,
  onJobTypeFilterChange,
  timeRangeFilter,
  onTimeRangeFilterChange,
  viewMode,
  onViewModeChange,
  visibleColumns,
  onToggleColumn,
  onExport,
  selectedCount = 0,
  onSaveView,
}: JobsFilterToolbarProps) {
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
  const showViewToggle = viewMode !== undefined && onViewModeChange !== undefined;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/50">
        {/* View Mode Toggle */}
        {showViewToggle && (
          <ToggleGroup 
            type="single" 
            value={viewMode} 
            onValueChange={(value) => value && onViewModeChange(value as JobsViewMode)}
            className="bg-background border rounded-lg p-0.5"
          >
            <ToggleGroupItem 
              value="summary" 
              aria-label="Summary view"
              className="h-8 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <LayoutGrid className="h-4 w-4 mr-1.5" />
              Summary
            </ToggleGroupItem>
            <ToggleGroupItem 
              value="list" 
              aria-label="List view"
              className="h-8 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <List className="h-4 w-4 mr-1.5" />
              List
            </ToggleGroupItem>
          </ToggleGroup>
        )}

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
                placeholder="e.g., Failed Jobs This Week"
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
