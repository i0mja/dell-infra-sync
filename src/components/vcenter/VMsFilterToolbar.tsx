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
import { Search, Columns3, Download, Save } from "lucide-react";
import { 
  VM_COLUMNS, 
  VM_TEMPLATE_FILTERS, 
  VM_SNAPSHOT_FILTERS, 
  VM_STATUS_FILTERS 
} from "@/lib/vcenter-column-definitions";

interface VMsFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  clusterFilter: string;
  onClusterFilterChange: (value: string) => void;
  powerFilter: string;
  onPowerFilterChange: (value: string) => void;
  toolsFilter: string;
  onToolsFilterChange: (value: string) => void;
  osFilter: string;
  onOsFilterChange: (value: string) => void;
  clusters: string[];
  // New filters
  templateFilter?: string;
  onTemplateFilterChange?: (value: string) => void;
  snapshotFilter?: string;
  onSnapshotFilterChange?: (value: string) => void;
  statusFilter?: string;
  onStatusFilterChange?: (value: string) => void;
  // Optional - for integrated toolbar
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
  onExport?: () => void;
  selectedCount?: number;
  onSaveView?: (name: string) => void;
}

export function VMsFilterToolbar({
  searchTerm,
  onSearchChange,
  clusterFilter,
  onClusterFilterChange,
  powerFilter,
  onPowerFilterChange,
  toolsFilter,
  onToolsFilterChange,
  osFilter,
  onOsFilterChange,
  clusters,
  templateFilter = "all",
  onTemplateFilterChange,
  snapshotFilter = "all",
  onSnapshotFilterChange,
  statusFilter = "all",
  onStatusFilterChange,
  visibleColumns,
  onToggleColumn,
  onExport,
  selectedCount = 0,
  onSaveView,
}: VMsFilterToolbarProps) {
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
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30 flex-wrap">
        <div className="relative flex-1 max-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search VMs..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-7 text-xs"
          />
        </div>

        <Select value={clusterFilter} onValueChange={onClusterFilterChange}>
          <SelectTrigger className="w-[110px] h-7 text-xs">
            <SelectValue placeholder="Cluster" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clusters</SelectItem>
            {clusters.map((cluster) => (
              <SelectItem key={cluster} value={cluster}>
                {cluster}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={powerFilter} onValueChange={onPowerFilterChange}>
          <SelectTrigger className="w-[90px] h-7 text-xs">
            <SelectValue placeholder="Power" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Power</SelectItem>
            <SelectItem value="poweredon">Powered On</SelectItem>
            <SelectItem value="poweredoff">Powered Off</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>

        <Select value={toolsFilter} onValueChange={onToolsFilterChange}>
          <SelectTrigger className="w-[90px] h-7 text-xs">
            <SelectValue placeholder="Tools" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tools</SelectItem>
            <SelectItem value="toolsok">OK</SelectItem>
            <SelectItem value="toolsold">Old</SelectItem>
            <SelectItem value="toolsnotinstalled">Not Installed</SelectItem>
            <SelectItem value="toolsnotrunning">Not Running</SelectItem>
          </SelectContent>
        </Select>

        <Select value={osFilter} onValueChange={onOsFilterChange}>
          <SelectTrigger className="w-[90px] h-7 text-xs">
            <SelectValue placeholder="OS" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All OS</SelectItem>
            <SelectItem value="windows">Windows</SelectItem>
            <SelectItem value="rhel">RHEL/CentOS</SelectItem>
            <SelectItem value="ubuntu">Ubuntu</SelectItem>
            <SelectItem value="debian">Debian</SelectItem>
            <SelectItem value="linux">Other Linux</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>

        {onTemplateFilterChange && (
          <Select value={templateFilter} onValueChange={onTemplateFilterChange}>
            <SelectTrigger className="w-[100px] h-7 text-xs">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {VM_TEMPLATE_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {onSnapshotFilterChange && (
          <Select value={snapshotFilter} onValueChange={onSnapshotFilterChange}>
            <SelectTrigger className="w-[110px] h-7 text-xs">
              <SelectValue placeholder="Snapshots" />
            </SelectTrigger>
            <SelectContent>
              {VM_SNAPSHOT_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {onStatusFilterChange && (
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-[100px] h-7 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {VM_STATUS_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {showActions && (
          <>
            <div className="flex-1" />

            {selectedCount > 0 && (
              <span className="text-xs text-muted-foreground">{selectedCount} sel</span>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 w-7 p-0">
                  <Columns3 className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 max-h-[400px] overflow-y-auto">
                <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {VM_COLUMNS.map((col) => (
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

            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={onExport}>
              <Download className="h-3.5 w-3.5" />
            </Button>

            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setSaveDialogOpen(true)}>
              <Save className="h-3.5 w-3.5" />
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
                placeholder="e.g., Production VMs"
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
