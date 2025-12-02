import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuTrigger, 
  DropdownMenuCheckboxItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator 
} from "@/components/ui/dropdown-menu";
import { HardDrive, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Download, Columns3, Server } from "lucide-react";
import type { VCenterDatastore } from "@/hooks/useVCenterData";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";
import { toast } from "sonner";

interface DatastoresTableProps {
  datastores: VCenterDatastore[];
  selectedDatastoreId: string | null;
  onDatastoreClick: (datastore: VCenterDatastore) => void;
  loading: boolean;
  searchTerm: string;
  typeFilter: string;
  accessFilter: string;
  capacityFilter: string;
  onExport?: () => void;
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
}

export function DatastoresTable({ 
  datastores, 
  selectedDatastoreId, 
  onDatastoreClick, 
  loading,
  searchTerm,
  typeFilter,
  accessFilter,
  capacityFilter,
  onExport,
  visibleColumns: parentVisibleColumns,
  onToggleColumn,
}: DatastoresTableProps) {
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedDatastores, setSelectedDatastores] = useState<Set<string>>(new Set());

  const { visibleColumns, isColumnVisible, toggleColumn: localToggleColumn } = useColumnVisibility("vcenter-datastores-columns", ["name", "type", "capacity", "free", "usage", "hosts", "vms", "status"]);

  const effectiveVisibleColumns = parentVisibleColumns || visibleColumns;
  const effectiveToggleColumn = onToggleColumn || localToggleColumn;
  const isColVisible = (col: string) => effectiveVisibleColumns.includes(col);

  const types = Array.from(new Set(datastores.map((ds) => ds.type).filter(Boolean))).sort() as string[];

  let filteredDatastores = datastores.filter((ds) => {
    const matchesSearch = !searchTerm || ds.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "all" || ds.type === typeFilter;
    const matchesAccess = accessFilter === "all" || (accessFilter === "accessible" && ds.accessible) || (accessFilter === "inaccessible" && !ds.accessible);
    
    const usagePercent = ds.capacity_bytes && ds.free_bytes ? Math.round(((ds.capacity_bytes - ds.free_bytes) / ds.capacity_bytes) * 100) : 0;
    const matchesCapacity = capacityFilter === "all" || (capacityFilter === "warning" && usagePercent >= 80 && usagePercent < 90) || (capacityFilter === "critical" && usagePercent >= 90);

    return matchesSearch && matchesType && matchesAccess && matchesCapacity;
  });

  if (sortField) {
    filteredDatastores = [...filteredDatastores].sort((a, b) => {
      let aVal: any = a[sortField as keyof typeof a];
      let bVal: any = b[sortField as keyof typeof b];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }

  // Apply pagination
  const pagination = usePagination(filteredDatastores, "vcenter-datastores-pagination", 50);

  const handleSort = (field: string) => {
    if (sortField === field) {
      if (sortDirection === "desc") { setSortField(null); setSortDirection("asc"); } else { setSortDirection("desc"); }
    } else { setSortField(field); setSortDirection("asc"); }
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3" />;
    return sortDirection === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const toggleAllDatastores = () => {
    if (selectedDatastores.size === filteredDatastores.length) { setSelectedDatastores(new Set()); } else { setSelectedDatastores(new Set(filteredDatastores.map((d) => d.id))); }
  };

  const handleExportCSV = () => {
    if (onExport) {
      onExport();
      return;
    }
    const columns: ExportColumn<VCenterDatastore>[] = [
      { key: "name", label: "Name" },
      { key: "type", label: "Type" },
      { key: "capacity_bytes", label: "Capacity (Bytes)" },
      { key: "free_bytes", label: "Free (Bytes)" },
      { key: "host_count", label: "Hosts" },
      { key: "vm_count", label: "VMs" },
      { key: "accessible", label: "Accessible", format: (v) => v ? "Yes" : "No" },
    ];
    const dsToExport = selectedDatastores.size > 0 ? filteredDatastores.filter((d) => selectedDatastores.has(d.id)) : filteredDatastores;
    exportToCSV(dsToExport, columns, "vcenter-datastores");
    toast.success(`Exported ${dsToExport.length} datastores`);
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return "0 TB";
    const tb = bytes / (1024 ** 4);
    return tb >= 1 ? `${tb.toFixed(2)} TB` : `${(bytes / (1024 ** 3)).toFixed(0)} GB`;
  };

  const getUsagePercent = (capacity: number | null, free: number | null) => {
    if (!capacity || !free) return 0;
    return Math.round(((capacity - free) / capacity) * 100);
  };

  const getUsageColor = (percent: number) => {
    if (percent >= 90) return "bg-destructive";
    if (percent >= 80) return "bg-warning";
    return "bg-primary";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          Loading datastores...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          {selectedDatastores.size > 0 && (
            <span className="text-sm text-muted-foreground">{selectedDatastores.size} selected</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="mr-1 h-4 w-4" /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={isColVisible("name")} onCheckedChange={() => effectiveToggleColumn("name")}>
                Name
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColVisible("type")} onCheckedChange={() => effectiveToggleColumn("type")}>
                Type
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColVisible("capacity")} onCheckedChange={() => effectiveToggleColumn("capacity")}>
                Capacity
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColVisible("free")} onCheckedChange={() => effectiveToggleColumn("free")}>
                Free
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColVisible("usage")} onCheckedChange={() => effectiveToggleColumn("usage")}>
                Usage
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColVisible("hosts")} onCheckedChange={() => effectiveToggleColumn("hosts")}>
                Hosts
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColVisible("vms")} onCheckedChange={() => effectiveToggleColumn("vms")}>
                VMs
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColVisible("status")} onCheckedChange={() => effectiveToggleColumn("status")}>
                Status
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-muted z-10">
              <TableRow>
                <TableHead className="w-12"><Checkbox checked={selectedDatastores.size === filteredDatastores.length} onCheckedChange={toggleAllDatastores} /></TableHead>
                {isColumnVisible("name") && <TableHead className="w-[250px] cursor-pointer" onClick={() => handleSort("name")}><div className="flex items-center">Name {getSortIcon("name")}</div></TableHead>}
                {isColumnVisible("type") && <TableHead className="w-[100px]">Type</TableHead>}
                {isColumnVisible("capacity") && <TableHead className="w-[120px] cursor-pointer" onClick={() => handleSort("capacity_bytes")}><div className="flex items-center">Capacity {getSortIcon("capacity_bytes")}</div></TableHead>}
                {isColumnVisible("free") && <TableHead className="w-[120px]">Free</TableHead>}
                {isColumnVisible("usage") && <TableHead className="w-[200px]">Usage</TableHead>}
                {isColumnVisible("hosts") && <TableHead className="w-[80px]">Hosts</TableHead>}
                {isColumnVisible("vms") && <TableHead className="w-[80px]">VMs</TableHead>}
                {isColumnVisible("status") && <TableHead className="w-[100px]">Status</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.paginatedItems.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No datastores found</TableCell></TableRow>
              ) : (
                pagination.paginatedItems.map((ds) => {
                  const usagePercent = getUsagePercent(ds.capacity_bytes, ds.free_bytes);
                  const isLowSpace = usagePercent >= 80;
                  return (
                    <TableRow key={ds.id} className={`cursor-pointer ${selectedDatastoreId === ds.id ? "bg-accent" : "hover:bg-accent/50"} ${usagePercent >= 90 ? "bg-destructive/10" : usagePercent >= 80 ? "bg-warning/10" : ""}`} onClick={() => onDatastoreClick(ds)}>
                      <TableCell><Checkbox checked={selectedDatastores.has(ds.id)} onCheckedChange={() => { const n = new Set(selectedDatastores); n.has(ds.id) ? n.delete(ds.id) : n.add(ds.id); setSelectedDatastores(n); }} onClick={(e) => e.stopPropagation()} /></TableCell>
                      {isColumnVisible("name") && <TableCell className="font-medium"><div className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-muted-foreground" />{ds.name}</div></TableCell>}
                      {isColumnVisible("type") && <TableCell><Badge variant="outline" className="text-xs">{ds.type || "Unknown"}</Badge></TableCell>}
                      {isColumnVisible("capacity") && <TableCell className="text-sm">{formatBytes(ds.capacity_bytes)}</TableCell>}
                      {isColumnVisible("free") && <TableCell className="text-sm">{formatBytes(ds.free_bytes)}</TableCell>}
                      {isColumnVisible("usage") && <TableCell><div className="space-y-1"><div className="flex items-center justify-between text-xs"><span className="font-medium">{usagePercent}% used</span>{isLowSpace && <AlertTriangle className="h-3 w-3 text-warning" />}</div><Progress value={usagePercent} className={`h-2 ${getUsageColor(usagePercent)}`} /></div></TableCell>}
                      {isColumnVisible("hosts") && <TableCell className="text-sm"><div className="flex items-center gap-1"><Server className="h-3 w-3 text-muted-foreground" />{ds.host_count || 0}</div></TableCell>}
                      {isColumnVisible("vms") && <TableCell className="text-sm"><div className="flex items-center gap-1"><HardDrive className="h-3 w-3 text-muted-foreground" />{ds.vm_count || 0}</div></TableCell>}
                      {isColumnVisible("status") && <TableCell>{ds.accessible ? <Badge variant="default" className="bg-success text-success-foreground text-xs">Accessible</Badge> : <Badge variant="destructive" className="text-xs">Inaccessible</Badge>}</TableCell>}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      <TablePagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={filteredDatastores.length}
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
    </div>
  );
}
