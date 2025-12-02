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
import { toast } from "sonner";

interface DatastoresFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  accessFilter: string;
  onAccessFilterChange: (value: string) => void;
  capacityFilter: string;
  onCapacityFilterChange: (value: string) => void;
  // Optional toolbar props
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
  onExport?: () => void;
  selectedCount?: number;
  onSaveView?: (name: string) => void;
}

export function DatastoresFilterToolbar({
  searchTerm,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  accessFilter,
  onAccessFilterChange,
  capacityFilter,
  onCapacityFilterChange,
  visibleColumns,
  onToggleColumn,
  onExport,
  selectedCount = 0,
  onSaveView,
}: DatastoresFilterToolbarProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");

  const isColumnVisible = (col: string) => visibleColumns?.includes(col) ?? true;

  const handleSaveView = () => {
    if (!viewName.trim()) {
      toast.error("Enter view name");
      return;
    }
    onSaveView?.(viewName);
    toast.success(`"${viewName}" saved`);
    setSaveDialogOpen(false);
    setViewName("");
  };

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search datastores..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={onTypeFilterChange}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="vmfs">VMFS</SelectItem>
            <SelectItem value="nfs">NFS</SelectItem>
            <SelectItem value="vsan">vSAN</SelectItem>
            <SelectItem value="vvol">vVol</SelectItem>
          </SelectContent>
        </Select>

        <Select value={accessFilter} onValueChange={onAccessFilterChange}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Accessible" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="accessible">Accessible</SelectItem>
            <SelectItem value="not-accessible">Not Accessible</SelectItem>
          </SelectContent>
        </Select>

        <Select value={capacityFilter} onValueChange={onCapacityFilterChange}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Capacity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Capacities</SelectItem>
            <SelectItem value="critical">&gt;90% Full</SelectItem>
            <SelectItem value="warning">&gt;75% Full</SelectItem>
            <SelectItem value="healthy">&lt;75% Full</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {selectedCount > 0 && (
          <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
        )}

        {onToggleColumn && visibleColumns && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="mr-1 h-4 w-4" /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={isColumnVisible("name")} onCheckedChange={() => onToggleColumn("name")}>
                Name
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible("type")} onCheckedChange={() => onToggleColumn("type")}>
                Type
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible("capacity")} onCheckedChange={() => onToggleColumn("capacity")}>
                Capacity
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible("free")} onCheckedChange={() => onToggleColumn("free")}>
                Free
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible("usage")} onCheckedChange={() => onToggleColumn("usage")}>
                Usage
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible("hosts")} onCheckedChange={() => onToggleColumn("hosts")}>
                Hosts
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible("vms")} onCheckedChange={() => onToggleColumn("vms")}>
                VMs
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible("status")} onCheckedChange={() => onToggleColumn("status")}>
                Status
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
        )}

        {onSaveView && (
          <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(true)}>
            <Save className="mr-1 h-4 w-4" /> Save View
          </Button>
        )}
      </div>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Current View</DialogTitle>
            <DialogDescription>Save the current filters and column settings</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="view-name">View Name</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g., 'Critical Capacity', 'VMFS Only'"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveView}>Save View</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
