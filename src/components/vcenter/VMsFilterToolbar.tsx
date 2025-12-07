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
  // Optional - for integrated toolbar
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
  onExport?: () => void;
  selectedCount?: number;
  onSaveView?: (name: string) => void;
}

const COLUMN_OPTIONS = [
  { key: "name", label: "VM Name" },
  { key: "power", label: "Power State" },
  { key: "ip", label: "IP Address" },
  { key: "resources", label: "CPU / RAM" },
  { key: "disk", label: "Disk" },
  { key: "os", label: "Guest OS" },
  { key: "tools", label: "VMware Tools" },
  { key: "cluster", label: "Cluster" },
];

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
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30">
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
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="poweredon">On</SelectItem>
            <SelectItem value="poweredoff">Off</SelectItem>
            <SelectItem value="suspended">Susp</SelectItem>
          </SelectContent>
        </Select>

        <Select value={toolsFilter} onValueChange={onToolsFilterChange}>
          <SelectTrigger className="w-[90px] h-7 text-xs">
            <SelectValue placeholder="Tools" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="toolsok">OK</SelectItem>
            <SelectItem value="toolsold">Old</SelectItem>
            <SelectItem value="toolsnotinstalled">None</SelectItem>
            <SelectItem value="toolsnotrunning">Stopped</SelectItem>
          </SelectContent>
        </Select>

        <Select value={osFilter} onValueChange={onOsFilterChange}>
          <SelectTrigger className="w-[90px] h-7 text-xs">
            <SelectValue placeholder="OS" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All OS</SelectItem>
            <SelectItem value="windows">Windows</SelectItem>
            <SelectItem value="rhel">RHEL</SelectItem>
            <SelectItem value="ubuntu">Ubuntu</SelectItem>
            <SelectItem value="debian">Debian</SelectItem>
            <SelectItem value="linux">Linux</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>

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
