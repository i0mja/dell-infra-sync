import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Search,
  Power,
  PowerOff,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Columns3,
  Save,
  Trash2,
  HardDrive,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { VCenterVM } from "@/hooks/useVCenterData";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { useSavedViews } from "@/hooks/useSavedViews";
import { toast } from "sonner";

interface VMsTableProps {
  vms: VCenterVM[];
  selectedVmId: string | null;
  onVmClick: (vm: VCenterVM) => void;
  loading: boolean;
}

export function VMsTable({ vms, selectedVmId, onVmClick, loading }: VMsTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [clusterFilter, setClusterFilter] = useState("all");
  const [powerFilter, setPowerFilter] = useState("all");
  const [toolsFilter, setToolsFilter] = useState("all");
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedVms, setSelectedVms] = useState<Set<string>>(new Set());
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");

  const { visibleColumns, isColumnVisible, toggleColumn } = useColumnVisibility("vcenter-vms-columns", [
    "name",
    "power",
    "ip",
    "resources",
    "disk",
    "os",
    "tools",
    "cluster",
  ]);

  const { savedViews, saveView, loadView, deleteView, clearView } = useSavedViews("vcenter-vms-views");

  const clusters = Array.from(new Set(vms.map((vm) => vm.cluster_name).filter(Boolean))).sort() as string[];

  // Filter VMs
  let filteredVms = vms.filter((vm) => {
    const matchesSearch =
      !searchTerm ||
      vm.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vm.ip_address?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vm.guest_os?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCluster = clusterFilter === "all" || vm.cluster_name === clusterFilter;
    const matchesPower = powerFilter === "all" || vm.power_state?.toLowerCase() === powerFilter;
    const matchesTools = toolsFilter === "all" || vm.tools_status?.toLowerCase() === toolsFilter;

    return matchesSearch && matchesCluster && matchesPower && matchesTools;
  });

  // Apply sorting
  if (sortField) {
    filteredVms = [...filteredVms].sort((a, b) => {
      let aVal: any = a[sortField as keyof typeof a];
      let bVal: any = b[sortField as keyof typeof b];

      if (aVal == null) return 1;
      if (bVal == null) return -1;

      const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }

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

  const toggleVmSelection = (vmId: string) => {
    const newSelected = new Set(selectedVms);
    if (newSelected.has(vmId)) {
      newSelected.delete(vmId);
    } else {
      newSelected.add(vmId);
    }
    setSelectedVms(newSelected);
  };

  const toggleAllVms = () => {
    if (selectedVms.size === filteredVms.length) {
      setSelectedVms(new Set());
    } else {
      setSelectedVms(new Set(filteredVms.map((v) => v.id)));
    }
  };

  const handleExportCSV = () => {
    const columns: ExportColumn<VCenterVM>[] = [
      { key: "name", label: "VM Name" },
      { key: "power_state", label: "Power State" },
      { key: "ip_address", label: "IP Address" },
      { key: "cpu_count", label: "CPUs" },
      { key: "memory_mb", label: "Memory (MB)" },
      { key: "disk_gb", label: "Disk (GB)" },
      { key: "guest_os", label: "Guest OS" },
      { key: "tools_status", label: "Tools Status" },
      { key: "cluster_name", label: "Cluster" },
    ];

    const vmsToExport = selectedVms.size > 0 ? filteredVms.filter((v) => selectedVms.has(v.id)) : filteredVms;

    exportToCSV(vmsToExport, columns, "vcenter-vms");
    toast.success(`Exported ${vmsToExport.length} VMs`);
  };

  const handleSaveView = () => {
    if (!viewName.trim()) {
      toast.error("Enter view name");
      return;
    }
    saveView(
      viewName,
      { cluster: clusterFilter, power: powerFilter, tools: toolsFilter },
      sortField || undefined,
      sortDirection,
      visibleColumns
    );
    toast.success(`"${viewName}" saved successfully`);
    setSaveDialogOpen(false);
    setViewName("");
  };

  const getPowerStateBadge = (state: string | null) => {
    switch (state?.toLowerCase()) {
      case "poweredon":
        return (
          <Badge variant="default" className="bg-success text-success-foreground text-xs">
            <Power className="mr-1 h-3 w-3" />
            On
          </Badge>
        );
      case "poweredoff":
        return (
          <Badge variant="secondary" className="text-xs">
            <PowerOff className="mr-1 h-3 w-3" />
            Off
          </Badge>
        );
      case "suspended":
        return (
          <Badge variant="outline" className="text-warning text-xs">
            <Loader2 className="mr-1 h-3 w-3" />
            Suspended
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs">
            Unknown
          </Badge>
        );
    }
  };

  const getToolsStatusBadge = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case "toolsok":
        return (
          <Badge variant="default" className="bg-success text-success-foreground text-xs">
            OK
          </Badge>
        );
      case "toolsold":
        return (
          <Badge variant="outline" className="text-warning text-xs">
            Old
          </Badge>
        );
      case "toolsnotinstalled":
        return (
          <Badge variant="destructive" className="text-xs">
            Not Installed
          </Badge>
        );
      case "toolsnotrunning":
        return (
          <Badge variant="secondary" className="text-xs">
            Not Running
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs">
            {status || "Unknown"}
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          Loading VMs...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/50">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search VMs, IPs, OS..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Select value={clusterFilter} onValueChange={setClusterFilter}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue placeholder="All Clusters" />
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

        <Select value={powerFilter} onValueChange={setPowerFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Power State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="poweredon">Powered On</SelectItem>
            <SelectItem value="poweredoff">Powered Off</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>

        <Select value={toolsFilter} onValueChange={setToolsFilter}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="Tools Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tools</SelectItem>
            <SelectItem value="toolsok">OK</SelectItem>
            <SelectItem value="toolsold">Old</SelectItem>
            <SelectItem value="toolsnotinstalled">Not Installed</SelectItem>
            <SelectItem value="toolsnotrunning">Not Running</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
        <Checkbox
          checked={selectedVms.size === filteredVms.length && filteredVms.length > 0}
          onCheckedChange={toggleAllVms}
        />
        <span className="text-xs text-muted-foreground">
          {selectedVms.size > 0 ? `${selectedVms.size} selected` : "Select all"}
        </span>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="mr-1 h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={isColumnVisible("name")} onCheckedChange={() => toggleColumn("name")}>
              VM Name
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("power")} onCheckedChange={() => toggleColumn("power")}>
              Power
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("ip")} onCheckedChange={() => toggleColumn("ip")}>
              IP Address
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("resources")}
              onCheckedChange={() => toggleColumn("resources")}
            >
              CPU/RAM
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("disk")} onCheckedChange={() => toggleColumn("disk")}>
              Disk
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("os")} onCheckedChange={() => toggleColumn("os")}>
              Guest OS
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("tools")} onCheckedChange={() => toggleColumn("tools")}>
              Tools
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("cluster")}
              onCheckedChange={() => toggleColumn("cluster")}
            >
              Cluster
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" onClick={handleExportCSV}>
          <Download className="mr-1 h-4 w-4" />
          Export
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Save className="mr-1 h-4 w-4" />
              Views
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel>Saved Views</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSaveDialogOpen(true)}>
              <Save className="mr-2 h-4 w-4" />
              Save Current View
            </DropdownMenuItem>
            {savedViews.length > 0 && (
              <>
                <DropdownMenuSeparator />
                {savedViews.map((view) => (
                  <DropdownMenuItem key={view.id} className="flex justify-between">
                    <span onClick={() => loadView(view.id)}>{view.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteView(view.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-hidden flex flex-col flex-1 m-4">
        {filteredVms.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-center text-muted-foreground">
              <HardDrive className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium mb-2">No VMs found</p>
              <p className="text-sm mb-4">Try adjusting your filters</p>
              <Button variant="outline" size="sm" onClick={clearView}>
                <X className="mr-1 h-4 w-4" />
                Clear Filters
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-auto flex-1">
              <Table>
                <TableHeader className="sticky top-0 bg-muted z-10">
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox checked={selectedVms.size === filteredVms.length} onCheckedChange={toggleAllVms} />
                    </TableHead>
                    {isColumnVisible("name") && (
                      <TableHead className="w-[250px] cursor-pointer" onClick={() => handleSort("name")}>
                        <div className="flex items-center">
                          VM Name {getSortIcon("name")}
                        </div>
                      </TableHead>
                    )}
                    {isColumnVisible("power") && (
                      <TableHead className="w-[120px] cursor-pointer" onClick={() => handleSort("power_state")}>
                        <div className="flex items-center">
                          Power {getSortIcon("power_state")}
                        </div>
                      </TableHead>
                    )}
                    {isColumnVisible("ip") && (
                      <TableHead className="w-[140px] cursor-pointer" onClick={() => handleSort("ip_address")}>
                        <div className="flex items-center">
                          IP Address {getSortIcon("ip_address")}
                        </div>
                      </TableHead>
                    )}
                    {isColumnVisible("resources") && <TableHead className="w-[100px]">CPU/RAM</TableHead>}
                    {isColumnVisible("disk") && (
                      <TableHead className="w-[80px] cursor-pointer" onClick={() => handleSort("disk_gb")}>
                        <div className="flex items-center">
                          Disk (GB) {getSortIcon("disk_gb")}
                        </div>
                      </TableHead>
                    )}
                    {isColumnVisible("os") && <TableHead className="w-[180px]">Guest OS</TableHead>}
                    {isColumnVisible("tools") && (
                      <TableHead className="w-[120px] cursor-pointer" onClick={() => handleSort("tools_status")}>
                        <div className="flex items-center">
                          Tools {getSortIcon("tools_status")}
                        </div>
                      </TableHead>
                    )}
                    {isColumnVisible("cluster") && <TableHead className="w-[140px]">Cluster</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVms.map((vm) => (
                    <TableRow
                      key={vm.id}
                      className={`cursor-pointer ${
                        selectedVmId === vm.id ? "bg-accent" : "hover:bg-accent/50"
                      } group`}
                      onClick={() => onVmClick(vm)}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedVms.has(vm.id)}
                          onCheckedChange={() => toggleVmSelection(vm.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableCell>
                      {isColumnVisible("name") && <TableCell className="font-medium">{vm.name}</TableCell>}
                      {isColumnVisible("power") && <TableCell>{getPowerStateBadge(vm.power_state)}</TableCell>}
                      {isColumnVisible("ip") && (
                        <TableCell className="text-sm font-mono text-xs">{vm.ip_address || "N/A"}</TableCell>
                      )}
                      {isColumnVisible("resources") && (
                        <TableCell className="text-sm">
                          {vm.cpu_count || 0} / {vm.memory_mb ? Math.round(vm.memory_mb / 1024) : 0}GB
                        </TableCell>
                      )}
                      {isColumnVisible("disk") && (
                        <TableCell className="text-sm">{vm.disk_gb ? vm.disk_gb.toFixed(0) : "0"}</TableCell>
                      )}
                      {isColumnVisible("os") && (
                        <TableCell className="text-sm truncate max-w-[180px]">{vm.guest_os || "Unknown"}</TableCell>
                      )}
                      {isColumnVisible("tools") && <TableCell>{getToolsStatusBadge(vm.tools_status)}</TableCell>}
                      {isColumnVisible("cluster") && <TableCell className="text-sm">{vm.cluster_name || "N/A"}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="border-t px-4 py-2 bg-muted/50 text-xs text-muted-foreground">
              Showing {filteredVms.length} of {vms.length} VMs
            </div>
          </>
        )}
      </div>

      {/* Save View Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Current View</DialogTitle>
            <DialogDescription>Give your view a name to save the current filters, sort, and column settings</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="view-name">View Name</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g., 'Powered On VMs', 'Old Tools'"
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
    </div>
  );
}
