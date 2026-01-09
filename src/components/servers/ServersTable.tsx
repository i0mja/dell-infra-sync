import { useState, Fragment } from "react";
import { Server } from "@/hooks/useServers";
import { compareValues } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Server as ServerIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Columns3,
  Save,
  Trash2,
  X,
  RefreshCw,
  Activity,
  ShieldCheck,
  Power,
  Link2,
  Monitor,
  Eye,
  Search,
  MoreHorizontal,
  Loader2,
  CheckSquare,
  ExternalLink,
  Upload,
  Cpu,
  Key,
  Edit,
  Settings,
  FolderPlus,
  AlertTriangle,
} from "lucide-react";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { BulkManageGroupsDialog } from "./BulkManageGroupsDialog";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { useSavedViews } from "@/hooks/useSavedViews";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";
import { ServerOperationIndicator } from "./ServerOperationIndicator";

interface GroupData {
  id: string;
  name: string;
  type?: "manual" | "vcenter";
  servers: Server[];
  onlineCount: number;
  linkedCount?: number;
}

interface ServersTableProps {
  servers: Server[];
  groupedData: GroupData[] | null;
  selectedServerId: string | null;
  selectedGroupId: string | null;
  onServerClick: (server: Server) => void;
  onGroupClick: (groupId: string) => void;
  onServerRefresh: (server: Server) => void;
  onServerTest: (server: Server) => void;
  onServerHealth: (server: Server) => void;
  onServerPower: (server: Server) => void;
  onServerDetails: (server: Server) => void;
  onAutoLinkVCenter?: (server: Server) => void;
  onConsoleLaunch?: (server: Server) => void;
  loading: boolean;
  refreshing: string | null;
  healthCheckServer: string | null;
  hasActiveHealthCheck: (id: string) => boolean;
  isIncomplete: (server: Server) => boolean;
  groupMemberships: any[];
  vCenterHosts: any[];
  renderExpandedRow: (server: Server) => React.ReactNode;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  groupFilter: string;
  onGroupFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  groups: Array<{ id: string; name: string }>;
  vCenterClusters: string[];
  onBulkAutoLink?: () => void;
  bulkLinking?: boolean;
  onServerDelete?: (server: Server) => void;
  onBulkDelete?: (serverIds: string[]) => void;
  onBulkUpdate?: (serverIds: string[]) => void;
  // Group-level operations
  onGroupUpdate?: (groupId: string, groupType: 'manual' | 'vcenter' | undefined, serverIds: string[]) => void;
  onGroupSafetyCheck?: (groupId: string, clusterName: string) => void;
  onGroupRefreshAll?: (serverIds: string[]) => void;
  onGroupHealthCheckAll?: (serverIds: string[]) => void;
  onGroupTestCredentials?: (serverIds: string[]) => void;
  onGroupFirmwareInventory?: (serverIds: string[]) => void;
  onGroupRename?: (groupId: string) => void;
  onGroupDelete?: (groupId: string) => void;
  onViewInVCenter?: (clusterName: string) => void;
  onCheckForUpdates?: (serverIds: string[], name: string) => void;
  onIdracSettings?: (server: Server) => void;
  hardwareIssues?: Map<string, { drive_issues: number; memory_issues: number }>;
}

export function ServersTable({
  servers,
  groupedData,
  selectedServerId,
  selectedGroupId,
  onServerClick,
  onGroupClick,
  onServerRefresh,
  onServerTest,
  onServerHealth,
  onServerPower,
  onServerDetails,
  onAutoLinkVCenter,
  onConsoleLaunch,
  loading,
  refreshing,
  hasActiveHealthCheck,
  groupMemberships = [],
  vCenterHosts = [],
  renderExpandedRow,
  searchTerm,
  onSearchChange,
  groupFilter,
  onGroupFilterChange,
  statusFilter,
  onStatusFilterChange,
  groups = [],
  vCenterClusters = [],
  onBulkAutoLink,
  bulkLinking = false,
  onServerDelete,
  onBulkDelete,
  onBulkUpdate,
  onGroupUpdate,
  onGroupSafetyCheck,
  onGroupRefreshAll,
  onGroupHealthCheckAll,
  onGroupTestCredentials,
  onGroupFirmwareInventory,
  onGroupRename,
  onGroupDelete,
  onViewInVCenter,
  onCheckForUpdates,
  onIdracSettings,
  hardwareIssues,
}: ServersTableProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupTargetServers, setGroupTargetServers] = useState<string[]>([]);
  const { toast } = useToast();

  const { visibleColumns, isColumnVisible, toggleColumn } = useColumnVisibility(
    "servers-table-columns",
    ["hostname", "ip", "status", "model", "service_tag", "idrac_firmware", "vcenter", "groups"]
  );

  const { savedViews, currentView, saveView, loadView, deleteView, clearView } = useSavedViews(
    "servers-table-views"
  );

  // Flatten servers for sorting
  const allServers = groupedData
    ? groupedData.flatMap((g) => g.servers.map((s) => ({ ...s, groupName: g.name, groupId: g.id })))
    : servers || [];

  // Get effective status for sorting (considers hardware issues for degraded state)
  const getEffectiveStatus = (server: Server): string => {
    if (server.connection_status === "online") {
      const issues = hardwareIssues?.get(server.id);
      if (issues && (issues.drive_issues > 0 || issues.memory_issues > 0)) {
        return "degraded"; // Degraded sorts before online alphabetically
      }
      return "online";
    }
    return server.connection_status || "unknown";
  };

  // Apply sorting
  const sortedServers = sortField
    ? [...allServers].sort((a, b) => {
        let aVal: any;
        let bVal: any;
        
        if (sortField === "connection_status") {
          // Use effective status for sorting (includes degraded)
          aVal = getEffectiveStatus(a);
          bVal = getEffectiveStatus(b);
        } else {
          aVal = a[sortField as keyof typeof a];
          bVal = b[sortField as keyof typeof b];
        }
        
        return compareValues(aVal, bVal, sortDirection);
      })
    : allServers;

  // Regroup after sorting (if grouped view)
  const sortedGroupedData =
    groupedData && sortField
      ? sortedServers.reduce((acc: GroupData[], server) => {
          const serverWithGroup = server as typeof server & { groupName: string; groupId: string };
          let group = acc.find((g) => g.id === serverWithGroup.groupId);
          if (!group) {
            const original = groupedData.find((g) => g.id === serverWithGroup.groupId);
            if (original) {
              group = { ...original, servers: [] };
              acc.push(group);
            }
          }
          if (group) {
            group.servers.push(server);
          }
          return acc;
        }, [])
      : groupedData;

  const displayGroups = sortedGroupedData;
  const displayServers = sortedServers;

  // Apply pagination  
  const pagination = usePagination(displayServers, "servers-pagination", 50);

  const toggleGroup = (groupId: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupId)) {
      newCollapsed.delete(groupId);
    } else {
      newCollapsed.add(groupId);
    }
    setCollapsedGroups(newCollapsed);
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
    return sortDirection === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const toggleServerSelection = (serverId: string) => {
    const newSelected = new Set(selectedServers);
    if (newSelected.has(serverId)) {
      newSelected.delete(serverId);
    } else {
      newSelected.add(serverId);
    }
    setSelectedServers(newSelected);
  };

  const toggleAllServers = () => {
    if (selectedServers.size === allServers.length) {
      setSelectedServers(new Set());
    } else {
      setSelectedServers(new Set(allServers.map((s) => s.id)));
    }
  };

  const handleExportCSV = () => {
    const columns: ExportColumn<Server>[] = [
      { key: "hostname", label: "Hostname" },
      { key: "ip_address", label: "IP Address" },
      { key: "connection_status", label: "Status" },
      { key: "model", label: "Model" },
      { key: "service_tag", label: "Service Tag" },
      { key: "idrac_firmware", label: "iDRAC Firmware" },
      { key: "vcenter_host_id", label: "vCenter Linked", format: (v) => (v ? "Yes" : "No") },
      { key: "overall_health", label: "Health" },
      { key: "power_state", label: "Power State" },
    ];

    const serversToExport =
      selectedServers.size > 0 ? allServers.filter((s) => selectedServers.has(s.id)) : allServers;

    exportToCSV(serversToExport, columns, "servers");
  };

  const handleSaveView = () => {
    if (!viewName.trim()) {
      toast({ title: "Enter view name", variant: "destructive" });
      return;
    }
    saveView(viewName, {}, sortField || undefined, sortDirection, visibleColumns);
    setSaveDialogOpen(false);
    setViewName("");
  };

  const handleRefreshSelected = () => {
    const selected = allServers.filter((s) => selectedServers.has(s.id));
    selected.forEach((server) => onServerRefresh(server));
  };

  const handleCopyToClipboard = async (value: string | null | undefined, label: string) => {
    if (!value) {
      toast({ title: `No ${label.toLowerCase()} to copy`, variant: "destructive" });
      return;
    }

    const { copyToClipboard } = await import("@/lib/clipboard");
    const success = await copyToClipboard(value);
    if (success) {
      toast({ title: "Copied", description: `${label} copied to clipboard` });
    } else {
      toast({ 
        title: "Copy failed", 
        description: "Unable to access clipboard. Try using HTTPS or a different browser.",
        variant: "destructive" 
      });
    }
  };

  // Select/deselect all servers in a group
  const selectAllInGroup = (serverIds: string[]) => {
    const allSelected = serverIds.every(id => selectedServers.has(id));
    const newSelected = new Set(selectedServers);
    
    if (allSelected) {
      serverIds.forEach(id => newSelected.delete(id));
    } else {
      serverIds.forEach(id => newSelected.add(id));
    }
    
    setSelectedServers(newSelected);
  };

  // Export specific group to CSV
  const handleExportGroupCSV = (group: GroupData) => {
    const columns: ExportColumn<Server>[] = [
      { key: "hostname", label: "Hostname" },
      { key: "ip_address", label: "IP Address" },
      { key: "connection_status", label: "Status" },
      { key: "model", label: "Model" },
      { key: "service_tag", label: "Service Tag" },
      { key: "idrac_firmware", label: "iDRAC Firmware" },
    ];

    exportToCSV(group.servers, columns, `servers-${group.name.toLowerCase().replace(/\s+/g, '-')}`);
  };

  const getStatusBadge = (server: Server) => {
    // Check for hardware issues if server is online
    const issues = hardwareIssues?.get(server.id);
    const hasCriticalIssue = issues && (issues.drive_issues > 0 || issues.memory_issues > 0);
    
    if (server.connection_status === "online" && hasCriticalIssue) {
      const totalIssues = (issues?.drive_issues || 0) + (issues?.memory_issues || 0);
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="default" className="bg-warning hover:bg-warning/90 text-warning-foreground text-xs">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Degraded
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{totalIssues} hardware issue{totalIssues > 1 ? 's' : ''} detected</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    
    switch (server.connection_status) {
      case "online":
        return (
          <Badge variant="default" className="bg-success text-success-foreground text-xs">
            Online
          </Badge>
        );
      case "offline":
        return (
          <Badge variant="destructive" className="text-xs">
            Offline
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

  const getVCenterLink = (serverId: string) => {
    const host = vCenterHosts?.find((h) => h.server_id === serverId);
    return host ? { linked: true, cluster: host.cluster } : { linked: false, cluster: null };
  };

  const getServerGroups = (serverId: string) => {
    return (
      groupMemberships
        ?.filter((membership) => membership?.server_id === serverId && membership?.server_groups)
        .map((membership) => membership.server_groups as any)
        .filter(Boolean) || []
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-12">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          Loading servers...
        </div>
      </div>
    );
  }

  if (allServers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-12">
        <div className="text-center text-muted-foreground">
          <ServerIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium mb-2">No servers found</p>
          <p className="text-sm mb-4">Add your first server or adjust your filters</p>
          <Button variant="outline" size="sm" onClick={clearView}>
            <X className="mr-1 h-4 w-4" />
            Clear Filters
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full border rounded-lg shadow-sm bg-card overflow-hidden">
      {/* Unified Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b flex-wrap bg-card">
        {/* Left: Selection */}
        <Checkbox
          checked={selectedServers.size === allServers.length && allServers.length > 0}
          onCheckedChange={toggleAllServers}
          className="h-3.5 w-3.5"
        />
        <span className="text-xs text-muted-foreground">
          {selectedServers.size > 0 ? `${selectedServers.size}` : "All"}
        </span>

        {/* Search - compact */}
        <div className="relative w-44">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>

        {/* Filters - compact selects */}
        <Select value={groupFilter} onValueChange={onGroupFilterChange}>
          <SelectTrigger className="w-[110px] h-7 text-xs">
            <SelectValue placeholder="Groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            <SelectItem value="ungrouped">Ungrouped</SelectItem>
            {groups.map((group: any) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
            {vCenterClusters.map((cluster: string) => (
              <SelectItem key={`cluster-${cluster}`} value={`cluster:${cluster}`}>
                🖥 {cluster}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="w-[100px] h-7 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
            <SelectItem value="incomplete">Incomplete</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {/* Right: Actions */}
        {selectedServers.size > 0 && (
          <>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={handleRefreshSelected}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Refresh
            </Button>
            {onBulkUpdate && (
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => onBulkUpdate(Array.from(selectedServers))}>
                <ShieldCheck className="h-3 w-3 mr-1" />
                Update
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 text-xs px-2" 
              onClick={() => {
                setGroupTargetServers(Array.from(selectedServers));
                setGroupDialogOpen(true);
              }}
            >
              <FolderPlus className="h-3 w-3 mr-1" />
              Group
            </Button>
            {onBulkDelete && (
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-destructive hover:text-destructive" 
                onClick={() => onBulkDelete(Array.from(selectedServers))}>
                <Trash2 className="h-3 w-3 mr-1" />
                Delete
              </Button>
            )}
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <Columns3 className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48 bg-background" align="end">
            <DropdownMenuLabel className="text-xs">Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("hostname")}
              onCheckedChange={() => toggleColumn("hostname")}
              className="text-xs"
            >
              Hostname
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isColumnVisible("ip")} onCheckedChange={() => toggleColumn("ip")} className="text-xs">
              IP Address
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("status")}
              onCheckedChange={() => toggleColumn("status")}
              className="text-xs"
            >
              Status
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("model")}
              onCheckedChange={() => toggleColumn("model")}
              className="text-xs"
            >
              Model
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("service_tag")}
              onCheckedChange={() => toggleColumn("service_tag")}
              className="text-xs"
            >
              Service Tag
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("idrac_firmware")}
              onCheckedChange={() => toggleColumn("idrac_firmware")}
              className="text-xs"
            >
              iDRAC FW
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("vcenter")}
              onCheckedChange={() => toggleColumn("vcenter")}
              className="text-xs"
            >
              vCenter
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isColumnVisible("groups")}
              onCheckedChange={() => toggleColumn("groups")}
              className="text-xs"
            >
              Groups
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleExportCSV}>
          <Download className="h-3 w-3" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <Save className="h-3 w-3" />
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
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-10 px-2"></TableHead>
              {isColumnVisible("hostname") && (
                <TableHead className="w-[160px] cursor-pointer text-xs px-2" onClick={() => handleSort("hostname")}>
                  <div className="flex items-center">
                    Hostname {getSortIcon("hostname")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("ip") && (
                <TableHead className="w-[120px] cursor-pointer text-xs px-2" onClick={() => handleSort("ip_address")}>
                  <div className="flex items-center">
                    IP {getSortIcon("ip_address")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("status") && (
                <TableHead className="w-[80px] cursor-pointer text-xs px-2" onClick={() => handleSort("connection_status")}>
                  <div className="flex items-center">
                    Status {getSortIcon("connection_status")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("model") && (
                <TableHead className="w-[150px] cursor-pointer text-xs px-2" onClick={() => handleSort("model")}>
                  <div className="flex items-center">
                    Model {getSortIcon("model")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("service_tag") && (
                <TableHead className="w-[100px] cursor-pointer text-xs px-2" onClick={() => handleSort("service_tag")}>
                  <div className="flex items-center">
                    Tag {getSortIcon("service_tag")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("idrac_firmware") && (
                <TableHead className="w-[110px] cursor-pointer text-xs px-2" onClick={() => handleSort("idrac_firmware")}>
                  <div className="flex items-center">
                    iDRAC {getSortIcon("idrac_firmware")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("vcenter") && <TableHead className="w-[70px] text-xs px-2">vCenter</TableHead>}
              {isColumnVisible("groups") && <TableHead className="w-[100px] text-xs px-2">Groups</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!displayGroups
              ? // Flat view - use paginated items
                pagination.paginatedItems.map((server) => (
                  <ContextMenu key={server.id}>
                    <ContextMenuTrigger asChild>
                      <TableRow
                        className={`cursor-pointer hover:bg-accent ${selectedServerId === server.id ? "bg-accent" : ""}`}
                        onClick={() => onServerClick(server)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()} className="py-1.5 px-2">
                          <Checkbox
                            checked={selectedServers.has(server.id)}
                            onCheckedChange={() => toggleServerSelection(server.id)}
                            className="h-3.5 w-3.5"
                          />
                        </TableCell>
                        {isColumnVisible("hostname") && (
                          <TableCell className="font-medium py-1.5 px-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate">{server.hostname || "—"}</span>
                              <ServerOperationIndicator 
                                serverId={server.id}
                                refreshing={refreshing === server.id}
                                hasActiveHealthCheck={hasActiveHealthCheck(server.id)}
                              />
                            </div>
                          </TableCell>
                        )}
                        {isColumnVisible("ip") && (
                          <TableCell className="font-mono text-xs py-1.5 px-2">{server.ip_address}</TableCell>
                        )}
                        {isColumnVisible("status") && <TableCell className="py-1.5 px-2">{getStatusBadge(server)}</TableCell>}
                        {isColumnVisible("model") && <TableCell className="text-xs py-1.5 px-2 truncate max-w-[150px]">{server.model || "—"}</TableCell>}
                        {isColumnVisible("service_tag") && (
                          <TableCell className="font-mono text-xs py-1.5 px-2">{server.service_tag || "—"}</TableCell>
                        )}
                        {isColumnVisible("idrac_firmware") && (
                          <TableCell className="text-xs py-1.5 px-2">{server.idrac_firmware || "—"}</TableCell>
                        )}
                        {isColumnVisible("vcenter") && (
                          <TableCell className="py-1.5 px-2">
                            {server.vcenter_host_id ? (
                              <Badge variant="default" className="text-xs px-1.5 py-0">
                                ✓
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("groups") && (
                          <TableCell className="text-xs text-muted-foreground py-1.5 px-2">
                            {getServerGroups(server.id)
                              .slice(0, 2)
                              .map((g: any) => g.name)
                              .join(", ") || "—"}
                          </TableCell>
                        )}
                      </TableRow>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56 bg-background">
                      <ContextMenuItem onClick={() => handleCopyToClipboard(server.ip_address, "IP Address")}>
                        <ClipboardCopy className="mr-2 h-4 w-4" />
                        Copy IP Address
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleCopyToClipboard(server.hostname, "Hostname")}>
                        <ClipboardCopy className="mr-2 h-4 w-4" />
                        Copy Hostname
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleCopyToClipboard(server.service_tag, "Service Tag")}>
                        <ClipboardCopy className="mr-2 h-4 w-4" />
                        Copy Service Tag
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      {onConsoleLaunch && (
                        <ContextMenuItem onClick={() => onConsoleLaunch(server)}>
                          <Monitor className="mr-2 h-4 w-4" />
                          Launch Console
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem onClick={() => onServerDetails(server)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => onServerRefresh(server)}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh Inventory
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => onServerTest(server)}>
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Test Credentials
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => onServerHealth(server)}>
                        <Activity className="mr-2 h-4 w-4" />
                        Health Check
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => onServerPower(server)}>
                        <Power className="mr-2 h-4 w-4" />
                        Power Controls
                      </ContextMenuItem>
                      {onIdracSettings && (
                        <ContextMenuItem onClick={() => onIdracSettings(server)}>
                          <Settings className="mr-2 h-4 w-4" />
                          iDRAC Settings
                        </ContextMenuItem>
                      )}
                      {onAutoLinkVCenter && !server.vcenter_host_id && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => onAutoLinkVCenter(server)}>
                            <Link2 className="mr-2 h-4 w-4" />
                            Auto-link vCenter
                          </ContextMenuItem>
                        </>
                      )}
                      {selectedServers.has(server.id) && selectedServers.size > 1 && onBulkUpdate && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => onBulkUpdate(Array.from(selectedServers))}>
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            Update Selected ({selectedServers.size})
                          </ContextMenuItem>
                        </>
                      )}
                      {onCheckForUpdates && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => onCheckForUpdates([server.id], server.hostname || server.ip_address)}>
                            <Search className="mr-2 h-4 w-4" />
                            Check for Updates
                          </ContextMenuItem>
                        </>
                      )}
                      <ContextMenuSeparator />
                      {selectedServers.has(server.id) && selectedServers.size > 1 ? (
                        <ContextMenuItem onClick={() => {
                          setGroupTargetServers(Array.from(selectedServers));
                          setGroupDialogOpen(true);
                        }}>
                          <FolderPlus className="mr-2 h-4 w-4" />
                          Add Selected to Group ({selectedServers.size})
                        </ContextMenuItem>
                      ) : (
                        <ContextMenuItem onClick={() => {
                          setGroupTargetServers([server.id]);
                          setGroupDialogOpen(true);
                        }}>
                          <FolderPlus className="mr-2 h-4 w-4" />
                          Add to Group...
                        </ContextMenuItem>
                      )}
                      {onServerDelete && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem 
                            className="text-destructive focus:text-destructive"
                            onClick={() => onServerDelete(server)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Server
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                ))
              : // Grouped view
                displayGroups.map((group) => {
                  const isCollapsed = collapsedGroups.has(group.id);
                  const isGroupSelected = selectedGroupId === group.id;
                  const serverIds = group.servers.map(s => s.id);
                  const isVCenterCluster = group.type === 'vcenter';
                  const isManualGroup = group.type === 'manual';
                  const allSelected = serverIds.every(id => selectedServers.has(id));

                  return (
                    <Fragment key={group.id}>
                      {/* Group Header Row with Context Menu */}
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <TableRow
                            key={`group-${group.id}`}
                            className={`cursor-pointer hover:bg-accent/50 font-medium ${isGroupSelected ? "bg-accent" : "bg-muted/30"}`}
                            onClick={() => {
                              toggleGroup(group.id);
                              onGroupClick(group.id);
                            }}
                          >
                            <TableCell colSpan={10} className="py-1.5 px-2">
                              <div className="flex items-center gap-1.5">
                                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                <span className="font-semibold text-xs">{group.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  ({group.servers.length}, {group.onlineCount}↑
                                  {group.linkedCount !== undefined && `, ${group.linkedCount}⚡`})
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        </ContextMenuTrigger>
                        
                        <ContextMenuContent className="w-64 bg-background">
                          {/* Selection Section */}
                          <ContextMenuItem onClick={() => selectAllInGroup(serverIds)}>
                            <CheckSquare className="mr-2 h-4 w-4" />
                            {allSelected ? 'Deselect All Servers' : 'Select All Servers'}
                          </ContextMenuItem>
                          
                          {/* vCenter Navigation - only for vCenter clusters */}
                          {isVCenterCluster && onViewInVCenter && (
                            <>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => onViewInVCenter(group.name)}>
                                <ExternalLink className="mr-2 h-4 w-4" />
                                View in vCenter
                              </ContextMenuItem>
                            </>
                          )}
                          
                          <ContextMenuSeparator />
                          
                          {/* Cluster Operations */}
                          {onGroupUpdate && (
                            <ContextMenuItem onClick={() => onGroupUpdate(group.id, group.type, serverIds)}>
                              <Upload className="mr-2 h-4 w-4" />
                              Rolling Cluster Update
                            </ContextMenuItem>
                          )}
                          
                          {isVCenterCluster && onGroupSafetyCheck && (
                            <ContextMenuItem onClick={() => onGroupSafetyCheck(group.id, group.name)}>
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              Pre-Flight Safety Check
                            </ContextMenuItem>
                          )}
                          
                          {onGroupFirmwareInventory && (
                            <ContextMenuItem onClick={() => onGroupFirmwareInventory(serverIds)}>
                              <Cpu className="mr-2 h-4 w-4" />
                              Collect Firmware Inventory
                            </ContextMenuItem>
                          )}
                          
                          {onCheckForUpdates && (
                            <ContextMenuItem onClick={() => onCheckForUpdates(serverIds, group.name)}>
                              <Search className="mr-2 h-4 w-4" />
                              Check for Updates
                            </ContextMenuItem>
                          )}
                          
                          <ContextMenuSeparator />
                          
                          {/* Bulk Server Operations */}
                          {onGroupRefreshAll && (
                            <ContextMenuItem onClick={() => onGroupRefreshAll(serverIds)}>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Refresh All Inventory
                            </ContextMenuItem>
                          )}
                          
                          {onGroupHealthCheckAll && (
                            <ContextMenuItem onClick={() => onGroupHealthCheckAll(serverIds)}>
                              <Activity className="mr-2 h-4 w-4" />
                              Health Check All
                            </ContextMenuItem>
                          )}
                          
                          {onGroupTestCredentials && (
                            <ContextMenuItem onClick={() => onGroupTestCredentials(serverIds)}>
                              <Key className="mr-2 h-4 w-4" />
                              Test All Credentials
                            </ContextMenuItem>
                          )}
                          
                          <ContextMenuSeparator />
                          
                          {/* Export & Copy */}
                          <ContextMenuItem onClick={() => handleExportGroupCSV(group)}>
                            <Download className="mr-2 h-4 w-4" />
                            Export to CSV
                          </ContextMenuItem>
                          
                          <ContextMenuItem onClick={() => handleCopyToClipboard(group.name, "Group Name")}>
                            <ClipboardCopy className="mr-2 h-4 w-4" />
                            Copy Group Name
                          </ContextMenuItem>
                          
                          {/* Manual Group Management - only for manual groups */}
                          {isManualGroup && (
                            <>
                              <ContextMenuSeparator />
                              {onGroupRename && (
                                <ContextMenuItem onClick={() => onGroupRename(group.id)}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Rename Group
                                </ContextMenuItem>
                              )}
                              {onGroupDelete && (
                                <ContextMenuItem 
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => onGroupDelete(group.id)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete Group
                                </ContextMenuItem>
                              )}
                            </>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>

                      {/* Server Rows */}
                      {!isCollapsed &&
                        group.servers.map((server) => (
                          <ContextMenu key={server.id}>
                            <ContextMenuTrigger asChild>
                              <TableRow
                                className={`cursor-pointer hover:bg-accent ${selectedServerId === server.id ? "bg-accent" : ""}`}
                                onClick={() => onServerClick(server)}
                              >
                                <TableCell onClick={(e) => e.stopPropagation()} className="py-1.5 px-2">
                                  <Checkbox
                                    checked={selectedServers.has(server.id)}
                                    onCheckedChange={() => toggleServerSelection(server.id)}
                                    className="h-3.5 w-3.5"
                                  />
                                </TableCell>
                                {isColumnVisible("hostname") && (
                                  <TableCell className="font-medium py-1.5 px-2 text-xs truncate">{server.hostname || "—"}</TableCell>
                                )}
                                {isColumnVisible("ip") && (
                                  <TableCell className="font-mono text-xs py-1.5 px-2">{server.ip_address}</TableCell>
                                )}
                                {isColumnVisible("status") && <TableCell className="py-1.5 px-2">{getStatusBadge(server)}</TableCell>}
                                {isColumnVisible("model") && (
                                  <TableCell className="text-xs py-1.5 px-2 truncate max-w-[150px]">{server.model || "—"}</TableCell>
                                )}
                                {isColumnVisible("service_tag") && (
                                  <TableCell className="font-mono text-xs py-1.5 px-2">{server.service_tag || "—"}</TableCell>
                                )}
                                {isColumnVisible("idrac_firmware") && (
                                  <TableCell className="text-xs py-1.5 px-2">{server.idrac_firmware || "—"}</TableCell>
                                )}
                                {isColumnVisible("vcenter") && (
                                  <TableCell className="py-1.5 px-2">
                                    {server.vcenter_host_id ? (
                                      <Badge variant="default" className="text-xs px-1.5 py-0">
                                        ✓
                                      </Badge>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                )}
                                {isColumnVisible("groups") && (
                                  <TableCell className="text-xs text-muted-foreground py-1.5 px-2">{group.name}</TableCell>
                                )}
                              </TableRow>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-56 bg-background">
                              <ContextMenuItem onClick={() => handleCopyToClipboard(server.ip_address, "IP Address")}>
                                <ClipboardCopy className="mr-2 h-4 w-4" />
                                Copy IP Address
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => handleCopyToClipboard(server.hostname, "Hostname")}>
                                <ClipboardCopy className="mr-2 h-4 w-4" />
                                Copy Hostname
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => handleCopyToClipboard(server.service_tag, "Service Tag")}>
                                <ClipboardCopy className="mr-2 h-4 w-4" />
                                Copy Service Tag
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              {onConsoleLaunch && (
                                <ContextMenuItem onClick={() => onConsoleLaunch(server)}>
                                  <Monitor className="mr-2 h-4 w-4" />
                                  Launch Console
                                </ContextMenuItem>
                              )}
                              <ContextMenuItem onClick={() => onServerDetails(server)}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => onServerRefresh(server)}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Refresh Inventory
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onServerTest(server)}>
                                <ShieldCheck className="mr-2 h-4 w-4" />
                                Test Credentials
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onServerHealth(server)}>
                                <Activity className="mr-2 h-4 w-4" />
                                Health Check
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => onServerPower(server)}>
                                <Power className="mr-2 h-4 w-4" />
                                Power Controls
                              </ContextMenuItem>
                              {onAutoLinkVCenter && !server.vcenter_host_id && (
                                <>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem onClick={() => onAutoLinkVCenter(server)}>
                                    <Link2 className="mr-2 h-4 w-4" />
                                    Auto-link vCenter
                                  </ContextMenuItem>
                                </>
                              )}
                              {selectedServers.has(server.id) && selectedServers.size > 1 && onBulkUpdate && (
                                <>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem onClick={() => onBulkUpdate(Array.from(selectedServers))}>
                                    <ShieldCheck className="mr-2 h-4 w-4" />
                                    Update Selected ({selectedServers.size})
                                  </ContextMenuItem>
                                </>
                              )}
                              <ContextMenuSeparator />
                              {selectedServers.has(server.id) && selectedServers.size > 1 ? (
                                <ContextMenuItem onClick={() => {
                                  setGroupTargetServers(Array.from(selectedServers));
                                  setGroupDialogOpen(true);
                                }}>
                                  <FolderPlus className="mr-2 h-4 w-4" />
                                  Add Selected to Group ({selectedServers.size})
                                </ContextMenuItem>
                              ) : (
                                <ContextMenuItem onClick={() => {
                                  setGroupTargetServers([server.id]);
                                  setGroupDialogOpen(true);
                                }}>
                                  <FolderPlus className="mr-2 h-4 w-4" />
                                  Add to Group...
                                </ContextMenuItem>
                              )}
                              {onServerDelete && (
                                <>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem 
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => onServerDelete(server)}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete Server
                                  </ContextMenuItem>
                                </>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                    </Fragment>
                  );
                })}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        totalItems={displayServers.length}
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

      {/* Save View Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Current View</DialogTitle>
            <DialogDescription>Save your current column configuration and sorting preferences</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="view-name">View Name</Label>
              <Input
                id="view-name"
                placeholder="e.g., Production Servers"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
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

      {/* Bulk Manage Groups Dialog */}
      <BulkManageGroupsDialog
        serverIds={groupTargetServers}
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
      />
    </div>
  );
}
