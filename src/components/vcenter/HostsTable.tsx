import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardCopy,
  Layers,
  Link2,
  RefreshCcw,
  Server,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Columns3,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { useSavedViews } from "@/hooks/useSavedViews";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";
import { TruncatedCell } from "@/components/ui/truncated-cell";

interface VCenterHost {
  id: string;
  name: string;
  cluster: string | null;
  vcenter_id: string | null;
  serial_number: string | null;
  server_id: string | null;
  esxi_version: string | null;
  status: string | null;
  maintenance_mode: boolean | null;
  last_sync: string | null;
}

interface ClusterGroup {
  name: string;
  hosts: VCenterHost[];
}

interface HostsTableProps {
  clusterGroups: ClusterGroup[];
  selectedHostId: string | null;
  selectedCluster: string | null;
  onHostClick: (host: VCenterHost) => void;
  onClusterClick: (clusterName: string) => void;
  onHostSync?: (host: VCenterHost) => void;
  onClusterUpdate?: (clusterName?: string) => void;
  onViewLinkedServer?: (host: VCenterHost) => void;
  onLinkToServer?: (host: VCenterHost) => void;
  onSync?: () => void;
  loading: boolean;
  onHostDelete?: (host: VCenterHost) => void;
  onBulkDelete?: (hostIds: string[]) => void;
  visibleColumns: string[];
  onSelectionChange?: (selectedIds: Set<string>) => void;
}

export function HostsTable({
  clusterGroups,
  selectedHostId,
  selectedCluster,
  onHostClick,
  onClusterClick,
  onHostSync,
  onClusterUpdate,
  onViewLinkedServer,
  onLinkToServer,
  onSync,
  loading,
  onHostDelete,
  onBulkDelete,
  visibleColumns,
  onSelectionChange,
}: HostsTableProps) {
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const isColumnVisible = (col: string) => visibleColumns.includes(col);

  // Flatten hosts for sorting
  const allHosts = clusterGroups.flatMap((g) => g.hosts.map((h) => ({ ...h, clusterName: g.name })));

  // Apply sorting
  const sortedHosts = sortField
    ? [...allHosts].sort((a, b) => {
        let aVal: any = a[sortField as keyof typeof a];
        let bVal: any = b[sortField as keyof typeof b];

        if (sortField === "linked") {
          aVal = a.server_id ? 1 : 0;
          bVal = b.server_id ? 1 : 0;
        }

        if (aVal == null) return 1;
        if (bVal == null) return -1;

        const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        return sortDirection === "asc" ? comparison : -comparison;
      })
    : allHosts;

  // Regroup after sorting
  const sortedClusterGroups: ClusterGroup[] = sortedHosts.reduce((acc: ClusterGroup[], host) => {
    let group = acc.find((g) => g.name === host.clusterName);
    if (!group) {
      group = { name: host.clusterName, hosts: [] };
      acc.push(group);
    }
    group.hosts.push(host);
    return acc;
  }, []);

  const displayGroups = sortField ? sortedClusterGroups : clusterGroups;

  // Apply pagination to sorted hosts
  const pagination = usePagination(sortedHosts, "vcenter-hosts-pagination", 50);

  const toggleCluster = (clusterName: string) => {
    const newCollapsed = new Set(collapsedClusters);
    if (newCollapsed.has(clusterName)) {
      newCollapsed.delete(clusterName);
    } else {
      newCollapsed.add(clusterName);
    }
    setCollapsedClusters(newCollapsed);
  };

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
    return sortDirection === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  const toggleHostSelection = (hostId: string) => {
    const newSelected = new Set(selectedHosts);
    if (newSelected.has(hostId)) {
      newSelected.delete(hostId);
    } else {
      newSelected.add(hostId);
    }
    setSelectedHosts(newSelected);
  };

  const toggleAllHosts = () => {
    if (selectedHosts.size === allHosts.length) {
      setSelectedHosts(new Set());
    } else {
      setSelectedHosts(new Set(allHosts.map((h) => h.id)));
    }
  };

  const handleExportCSV = () => {
    const columns: ExportColumn<VCenterHost>[] = [
      { key: "name", label: "Hostname" },
      { key: "status", label: "Status" },
      { key: "maintenance_mode", label: "Maintenance", format: (v) => (v ? "Yes" : "No") },
      { key: "esxi_version", label: "ESXi Version" },
      { key: "serial_number", label: "Serial Number" },
      { key: "server_id", label: "Linked", format: (v) => (v ? "Yes" : "No") },
      { key: "cluster", label: "Cluster" },
      { key: "last_sync", label: "Last Sync" },
    ];

    const hostsToExport = selectedHosts.size > 0 
      ? allHosts.filter((h) => selectedHosts.has(h.id))
      : allHosts;

    exportToCSV(hostsToExport, columns, "vcenter-hosts");
    toast({ title: "Export successful", description: `Exported ${hostsToExport.length} hosts` });
  };

  // Save view handled by filter toolbar

  const handleSyncSelected = () => {
    const selected = allHosts.filter((h) => selectedHosts.has(h.id));
    selected.forEach((host) => onHostSync?.(host));
    toast({ title: "Syncing hosts", description: `Started sync for ${selected.length} hosts` });
  };

  const copyToClipboard = async (value: string | null | undefined, label: string) => {
    if (!value) {
      toast({ title: `No ${label.toLowerCase()} to copy`, variant: "destructive" });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied`, description: value });
    } catch (error: any) {
      toast({ title: "Copy failed", description: error?.message, variant: "destructive" });
    }
  };

  const getStatusBadge = (host: VCenterHost) => {
    if (host.maintenance_mode) {
      return (
        <Badge variant="destructive" className="text-xs">
          Maintenance
        </Badge>
      );
    }

    const status = host.status?.toLowerCase();
    
    switch (status) {
      case "connected":
      case "online":
        return (
          <Badge variant="default" className="bg-success text-success-foreground text-xs">
            Online
          </Badge>
        );
      case "disconnected":
      case "offline":
        return (
          <Badge variant="destructive" className="text-xs">
            Offline
          </Badge>
        );
      case "unreachable":
      case "notresponding":
        return (
          <Badge variant="outline" className="text-yellow-600 border-yellow-600 text-xs">
            Unreachable
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="text-xs">
            Unknown
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          Loading hosts...
        </div>
      </div>
    );
  }

  if (displayGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-center text-muted-foreground">
          <Server className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium mb-2">No hosts found</p>
          <p className="text-sm mb-4">Try adjusting your filters or sync vCenter data</p>
          <Button variant="default" size="sm" onClick={() => onSync?.()}>
            <RefreshCcw className="mr-1 h-4 w-4" />
            Sync Now
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Selection info */}
      {selectedHosts.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
          <span className="text-sm text-muted-foreground">{selectedHosts.size} selected</span>
          <Button variant="ghost" size="sm" onClick={handleSyncSelected}>
            <RefreshCcw className="h-3.5 w-3.5 mr-1" />
            Sync Selected
          </Button>
          {onBulkDelete && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
              onClick={() => onBulkDelete(Array.from(selectedHosts))}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Remove ({selectedHosts.size})
            </Button>
          )}
        </div>
      )}
      
      {/* Table */}
      <div className="overflow-auto flex-1">
        <Table>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              <TableHead className="w-12">
                <Checkbox checked={selectedHosts.size === allHosts.length} onCheckedChange={toggleAllHosts} />
              </TableHead>
              {isColumnVisible("name") && (
                <TableHead className="w-[280px] cursor-pointer" onClick={() => handleSort("name")}>
                  <div className="flex items-center">
                    Hostname {getSortIcon("name")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("status") && (
                <TableHead className="w-[140px] cursor-pointer" onClick={() => handleSort("status")}>
                  <div className="flex items-center">
                    Status {getSortIcon("status")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("esxi") && (
                <TableHead className="w-[120px] cursor-pointer" onClick={() => handleSort("esxi_version")}>
                  <div className="flex items-center">
                    ESXi Version {getSortIcon("esxi_version")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("serial") && (
                <TableHead className="w-[160px] cursor-pointer" onClick={() => handleSort("serial_number")}>
                  <div className="flex items-center">
                    Serial Number {getSortIcon("serial_number")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("linked") && (
                <TableHead className="w-[100px] cursor-pointer" onClick={() => handleSort("linked")}>
                  <div className="flex items-center">
                    Linked {getSortIcon("linked")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("sync") && (
                <TableHead className="w-[140px] cursor-pointer" onClick={() => handleSort("last_sync")}>
                  <div className="flex items-center">
                    Last Sync {getSortIcon("last_sync")}
                  </div>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.paginatedItems.map((host) => {
              const isHostSelected = selectedHostId === host.id;
              return (
                <ContextMenu key={host.id}>
                  <ContextMenuTrigger asChild>
                    <TableRow
                      className={`cursor-pointer ${
                        isHostSelected ? "bg-accent" : "hover:bg-accent/50"
                      } group`}
                      onClick={() => onHostClick(host)}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedHosts.has(host.id)}
                          onCheckedChange={() => toggleHostSelection(host.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableCell>
                      {isColumnVisible("name") && (
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {host.name}
                            <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onHostSync?.(host);
                                }}
                              >
                                <RefreshCcw className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(host.serial_number, "Serial");
                                }}
                              >
                                <ClipboardCopy className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      )}
                      {isColumnVisible("status") && <TableCell>{getStatusBadge(host)}</TableCell>}
                      {isColumnVisible("esxi") && (
                        <TableCell className="text-sm">{host.esxi_version || "N/A"}</TableCell>
                      )}
                      {isColumnVisible("serial") && (
                        <TableCell className="font-mono text-xs">
                          <TruncatedCell value={host.serial_number} maxWidth="160px" />
                        </TableCell>
                      )}
                      {isColumnVisible("linked") && (
                        <TableCell>
                          {host.server_id ? (
                            <Badge variant="default" className="bg-success text-success-foreground text-xs">
                              <Link2 className="mr-1 h-3 w-3" />
                              Linked
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">Not Linked</Badge>
                          )}
                        </TableCell>
                      )}
                      {isColumnVisible("sync") && (
                        <TableCell className="text-xs text-muted-foreground">
                          {host.last_sync ? formatDistanceToNow(new Date(host.last_sync), { addSuffix: true }) : "Never"}
                        </TableCell>
                      )}
                    </TableRow>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => onHostClick(host)}>
                      <Layers className="mr-2 h-4 w-4" />
                      View Details
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onHostSync?.(host)}>
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Sync Host
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    {host.server_id ? (
                      <ContextMenuItem onClick={() => onViewLinkedServer?.(host)}>
                        <Server className="mr-2 h-4 w-4" />
                        View Linked Server
                      </ContextMenuItem>
                    ) : (
                      <ContextMenuItem onClick={() => onLinkToServer?.(host)}>
                        <Link2 className="mr-2 h-4 w-4" />
                        Link to Server
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => copyToClipboard(host.name, "Hostname")}>
                      <ClipboardCopy className="mr-2 h-4 w-4" />
                      Copy Hostname
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => copyToClipboard(host.serial_number, "Serial Number")}>
                      <ClipboardCopy className="mr-2 h-4 w-4" />
                      Copy Serial
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        totalItems={allHosts.length}
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
