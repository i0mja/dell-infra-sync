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
  DropdownMenuItem,
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
  ChevronDown,
  ChevronRight,
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
  loading: boolean;
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
  loading,
}: HostsTableProps) {
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const { toast } = useToast();

  const { visibleColumns, isColumnVisible, toggleColumn } = useColumnVisibility(
    "vcenter-hosts-columns",
    ["name", "status", "esxi", "serial", "linked", "sync"]
  );

  const { savedViews, currentView, saveView, loadView, deleteView, clearView } = useSavedViews(
    "vcenter-hosts-views"
  );

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

  const handleSaveView = () => {
    if (!viewName.trim()) {
      toast({ title: "Enter view name", variant: "destructive" });
      return;
    }
    saveView(viewName, {}, sortField || undefined, sortDirection, visibleColumns);
    toast({ title: "View saved", description: `"${viewName}" saved successfully` });
    setSaveDialogOpen(false);
    setViewName("");
  };

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

    switch (host.status?.toLowerCase()) {
      case "connected":
        return (
          <Badge variant="default" className="bg-success text-success-foreground text-xs">
            Connected
          </Badge>
        );
      case "disconnected":
        return (
          <Badge variant="destructive" className="text-xs">
            Disconnected
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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={clearView}>
              <X className="mr-1 h-4 w-4" />
              Clear Filters
            </Button>
            <Button variant="default" size="sm" onClick={() => onClusterUpdate?.()}>
              <RefreshCcw className="mr-1 h-4 w-4" />
              Sync Now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-hidden flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <Checkbox
          checked={selectedHosts.size === allHosts.length && allHosts.length > 0}
          onCheckedChange={toggleAllHosts}
        />
        <span className="text-xs text-muted-foreground">
          {selectedHosts.size > 0 ? `${selectedHosts.size} selected` : "Select all"}
        </span>
        
        <div className="flex-1" />

        {selectedHosts.size > 0 && (
          <Button variant="outline" size="sm" onClick={handleSyncSelected}>
            <RefreshCcw className="mr-1 h-4 w-4" />
            Sync Selected
          </Button>
        )}

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
              Hostname
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("status")} onCheckedChange={() => toggleColumn("status")}>
              Status
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("esxi")} onCheckedChange={() => toggleColumn("esxi")}>
              ESXi Version
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("serial")} onCheckedChange={() => toggleColumn("serial")}>
              Serial Number
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("linked")} onCheckedChange={() => toggleColumn("linked")}>
              Linked
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("sync")} onCheckedChange={() => toggleColumn("sync")}>
              Last Sync
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
            {displayGroups.map((cluster) => {
              const isCollapsed = collapsedClusters.has(cluster.name);
              const linkedCount = cluster.hosts.filter((h) => h.server_id).length;
              const connectedCount = cluster.hosts.filter((h) => h.status === "connected").length;
              const isClusterSelected = selectedCluster === cluster.name;

              return (
                <>
                  {/* Cluster Header Row */}
                  <TableRow
                    key={`cluster-${cluster.name}`}
                    className={`cursor-pointer hover:bg-accent/50 font-medium ${
                      isClusterSelected ? "bg-accent" : "bg-muted/30"
                    }`}
                    onClick={() => {
                      toggleCluster(cluster.name);
                      onClusterClick(cluster.name);
                    }}
                  >
                    <TableCell colSpan={7} className="py-2">
                      <div className="flex items-center gap-2">
                        {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span className="font-semibold">{cluster.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({cluster.hosts.length} hosts, {linkedCount} linked, {connectedCount} connected)
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Host Rows */}
                  {!isCollapsed &&
                    cluster.hosts.map((host) => (
                      <ContextMenu key={host.id}>
                        <ContextMenuTrigger asChild>
                          <TableRow
                            className={`cursor-pointer ${
                              selectedHostId === host.id ? "bg-accent" : "hover:bg-accent/50"
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
                              <TableCell className="font-medium pl-8">
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
                              <TableCell className="text-sm font-mono text-xs">
                                {host.serial_number || "N/A"}
                              </TableCell>
                            )}
                            {isColumnVisible("linked") && (
                              <TableCell>
                                {host.server_id ? (
                                  <Badge variant="secondary" className="text-xs">
                                    ✓ Yes
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">
                                    ✗ No
                                  </Badge>
                                )}
                              </TableCell>
                            )}
                            {isColumnVisible("sync") && (
                              <TableCell className="text-sm text-muted-foreground">
                                {host.last_sync
                                  ? formatDistanceToNow(new Date(host.last_sync), { addSuffix: true })
                                  : "Never"}
                              </TableCell>
                            )}
                          </TableRow>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-72">
                          <ContextMenuItem onClick={() => onHostClick(host)}>
                            <Server className="mr-2 h-4 w-4" />
                            Open host details
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuSub>
                            <ContextMenuSubTrigger>
                              <Server className="mr-2 h-4 w-4" />
                              Server mapping
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              <ContextMenuItem
                                disabled={!host.server_id}
                                onClick={() => onViewLinkedServer?.(host)}
                              >
                                <Link2 className="mr-2 h-4 w-4" />
                                {host.server_id ? "Open linked server" : "No linked server"}
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onLinkToServer?.(host)}>
                                <Layers className="mr-2 h-4 w-4" />
                                Link or match server
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => copyToClipboard(host.serial_number, "Serial number")}>
                                <ClipboardCopy className="mr-2 h-4 w-4" />
                                Copy serial number
                              </ContextMenuItem>
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSub>
                            <ContextMenuSubTrigger>
                              <Layers className="mr-2 h-4 w-4" />
                              Cluster actions
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              <ContextMenuItem onClick={() => onClusterClick(host.cluster || "Unclustered")}>
                                <ChevronRight className="mr-2 h-4 w-4" />
                                View cluster summary
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onClusterUpdate?.(host.cluster || undefined)}>
                                <RefreshCcw className="mr-2 h-4 w-4" />
                                Open cluster update wizard
                              </ContextMenuItem>
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSub>
                            <ContextMenuSubTrigger>
                              <RefreshCcw className="mr-2 h-4 w-4" />
                              vCenter actions
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              <ContextMenuItem onClick={() => onHostSync?.(host)}>
                                <RefreshCcw className="mr-2 h-4 w-4" />
                                Sync this host
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => copyToClipboard(host.vcenter_id, "vCenter host ID")}>
                                <ClipboardCopy className="mr-2 h-4 w-4" />
                                Copy vCenter host ID
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => copyToClipboard(host.name, "Hostname")}>
                                <ClipboardCopy className="mr-2 h-4 w-4" />
                                Copy hostname
                              </ContextMenuItem>
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-2 bg-muted/50 text-xs text-muted-foreground">
        Showing {displayGroups.reduce((acc, g) => acc + g.hosts.length, 0)} hosts in {displayGroups.length} cluster
        {displayGroups.length !== 1 ? "s" : ""}
      </div>

      {/* Save View Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Current View</DialogTitle>
            <DialogDescription>Give your view a name to save the current sort and column settings</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="view-name">View Name</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g., 'Connected Hosts', 'Unlinked Only'"
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
