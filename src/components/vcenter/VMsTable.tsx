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
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";
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
  const [osFilter, setOsFilter] = useState("all");
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
    
    const matchesOs = osFilter === "all" || (() => {
      const os = vm.guest_os?.toLowerCase() || '';
      switch(osFilter) {
        case 'windows': return os.includes('windows');
        case 'rhel': return os.includes('centos') || os.includes('rhel') || os.includes('red hat');
        case 'ubuntu': return os.includes('ubuntu');
        case 'debian': return os.includes('debian');
        case 'linux': return os.includes('linux') && !os.includes('windows');
        case 'other': return !os.includes('windows') && !os.includes('centos') && !os.includes('rhel') && !os.includes('red hat') && !os.includes('ubuntu') && !os.includes('debian') && !os.includes('linux');
        default: return true;
      }
    })();

    return matchesSearch && matchesCluster && matchesPower && matchesTools && matchesOs;
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

  // Apply pagination
  const pagination = usePagination(filteredVms, "vcenter-vms-pagination", 50);

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
      { cluster: clusterFilter, power: powerFilter, tools: toolsFilter, os: osFilter },
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
    <div className="flex flex-col h-full bg-background overflow-hidden">
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
                  {pagination.paginatedItems.map((vm) => (
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

            <TablePagination
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              totalItems={filteredVms.length}
              pageSize={pagination.pageSize}
              startIndex={pagination.startIndex}
              endIndex={pagination.endIndex}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
              onFirstPage={pagination.goToFirstPage}
              onLastPage={pagination.goToLastPage}
              onNextPage={pagination.goToNextPage}
              onPrevPage={pagination.goToPrevPage}
              canGoNext={pagination.canGoNext}
              canGoPrev={pagination.canGoPrev}
            />
        </>
      )}

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
