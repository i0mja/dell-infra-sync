import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { compareValues } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Network, Wifi, Server, ArrowUpDown, ArrowUp, ArrowDown, MapPin } from "lucide-react";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";
import type { VCenterNetwork } from "@/hooks/useVCenterData";

interface GroupedNetwork {
  name: string;
  networks: VCenterNetwork[];
  totalHostCount: number;
  totalVmCount: number;
  siteCount: number;
  vlanId: number | null;
  vlanRange: string | null;
  networkType: string | null;
  vcenterNames: string[];
}

interface NetworksTableProps {
  networks: VCenterNetwork[];
  selectedNetworkId: string | null;
  onNetworkClick: (network: VCenterNetwork) => void;
  loading: boolean;
  searchTerm: string;
  typeFilter: string;
  vlanFilter: string;
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
  groupByName?: boolean;
  vcenterMap?: Map<string, string>;
}

export function NetworksTable({ 
  networks, 
  selectedNetworkId, 
  onNetworkClick, 
  loading,
  searchTerm,
  typeFilter,
  vlanFilter,
  visibleColumns: parentVisibleColumns,
  onToggleColumn,
  groupByName = false,
  vcenterMap = new Map(),
}: NetworksTableProps) {
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedNetworks, setSelectedNetworks] = useState<Set<string>>(new Set());

  const { visibleColumns, toggleColumn: localToggleColumn } = useColumnVisibility(
    "vcenter-networks-columns", 
    ["name", "type", "vlan", "sites", "hosts", "vms"]
  );

  const effectiveVisibleColumns = parentVisibleColumns || visibleColumns;
  const effectiveToggleColumn = onToggleColumn || localToggleColumn;
  const isColVisible = (col: string) => effectiveVisibleColumns.includes(col);

  // Filter networks
  const filteredNetworks = useMemo(() => {
    return networks.filter((net) => {
      const matchesSearch = !searchTerm || 
        net.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        net.parent_switch_name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = typeFilter === "all" || net.network_type === typeFilter;
      
      let matchesVlan = true;
      if (vlanFilter !== "all") {
        if (vlanFilter === "tagged") {
          matchesVlan = !!net.vlan_id || !!net.vlan_range;
        } else if (vlanFilter === "untagged") {
          matchesVlan = !net.vlan_id && !net.vlan_range;
        }
      }

      // Exclude uplink port groups by default
      const notUplink = !net.uplink_port_group;

      return matchesSearch && matchesType && matchesVlan && notUplink;
    });
  }, [networks, searchTerm, typeFilter, vlanFilter]);

  // Group networks by name
  const groupedNetworks = useMemo(() => {
    if (!groupByName) return null;

    const groups = new Map<string, GroupedNetwork>();
    
    filteredNetworks.forEach(net => {
      if (!groups.has(net.name)) {
        groups.set(net.name, {
          name: net.name,
          networks: [],
          totalHostCount: 0,
          totalVmCount: 0,
          siteCount: 0,
          vlanId: net.vlan_id,
          vlanRange: net.vlan_range,
          networkType: net.network_type,
          vcenterNames: [],
        });
      }
      const group = groups.get(net.name)!;
      group.networks.push(net);
      group.totalHostCount += net.host_count || 0;
      group.totalVmCount += net.vm_count || 0;
      
      // Track unique vCenters
      if (net.source_vcenter_id) {
        const vcName = vcenterMap.get(net.source_vcenter_id) || 'Unknown';
        if (!group.vcenterNames.includes(vcName)) {
          group.vcenterNames.push(vcName);
        }
      }
      group.siteCount = group.vcenterNames.length;
    });
    
    return Array.from(groups.values());
  }, [filteredNetworks, groupByName, vcenterMap]);

  // Sort grouped data
  const sortedGroupedData = useMemo((): GroupedNetwork[] => {
    if (!groupedNetworks) return [];
    if (!sortField) return groupedNetworks;
    
    return [...groupedNetworks].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case 'name': aVal = a.name; bVal = b.name; break;
        case 'network_type': aVal = a.networkType; bVal = b.networkType; break;
        case 'vlan_id': aVal = a.vlanId; bVal = b.vlanId; break;
        case 'host_count': aVal = a.totalHostCount; bVal = b.totalHostCount; break;
        case 'vm_count': aVal = a.totalVmCount; bVal = b.totalVmCount; break;
        case 'site_count': aVal = a.siteCount; bVal = b.siteCount; break;
        default: aVal = a.name; bVal = b.name;
      }
      return compareValues(aVal, bVal, sortDirection);
    });
  }, [groupedNetworks, sortField, sortDirection]);

  // Sort flat data
  const sortedFlatData = useMemo((): VCenterNetwork[] => {
    if (!sortField) return filteredNetworks;
    
    return [...filteredNetworks].sort((a, b) => {
      const aVal = a[sortField as keyof typeof a];
      const bVal = b[sortField as keyof typeof b];
      return compareValues(aVal, bVal, sortDirection);
    });
  }, [filteredNetworks, sortField, sortDirection]);

  const paginationGrouped = usePagination(sortedGroupedData, "vcenter-networks-grouped-pagination", 50);
  const paginationFlat = usePagination(sortedFlatData, "vcenter-networks-flat-pagination", 50);
  
  // Use appropriate pagination based on mode
  const pagination = groupByName ? paginationGrouped : paginationFlat;
  const { currentPage, totalPages, pageSize, startIndex, endIndex, setPage, setPageSize, goToFirstPage, goToLastPage, goToNextPage, goToPrevPage, canGoNext, canGoPrev } = pagination;
  
  const paginatedGroupedItems = paginationGrouped.paginatedItems;
  const paginatedFlatItems = paginationFlat.paginatedItems;

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

  const toggleAllNetworks = () => {
    if (groupByName && groupedNetworks) {
      if (selectedNetworks.size === groupedNetworks.length) { 
        setSelectedNetworks(new Set()); 
      } else { 
        setSelectedNetworks(new Set(groupedNetworks.map((g) => g.name))); 
      }
    } else {
      if (selectedNetworks.size === filteredNetworks.length) { 
        setSelectedNetworks(new Set()); 
      } else { 
        setSelectedNetworks(new Set(filteredNetworks.map((n) => n.id))); 
      }
    }
  };

  const toggleNetwork = (id: string) => {
    const newSelected = new Set(selectedNetworks);
    if (newSelected.has(id)) { 
      newSelected.delete(id); 
    } else { 
      newSelected.add(id); 
    }
    setSelectedNetworks(newSelected);
  };

  const getNetworkTypeBadge = (type: string | null) => {
    if (!type) return <Badge variant="outline">Unknown</Badge>;
    
    const variants: Record<string, { variant: "default" | "secondary" | "outline", label: string }> = {
      distributed: { variant: "default", label: "Distributed" },
      standard: { variant: "secondary", label: "Standard" },
      opaque: { variant: "outline", label: "Opaque" },
    };
    
    const config = variants[type] || { variant: "outline" as const, label: type };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getVlanDisplay = (vlanId: number | null, vlanRange: string | null) => {
    if (vlanRange) {
      return <span className="text-xs font-mono">{vlanRange}</span>;
    }
    if (vlanId) {
      return <Badge variant="outline" className="font-mono">{vlanId}</Badge>;
    }
    return <span className="text-muted-foreground text-xs">—</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading networks...</div>
      </div>
    );
  }

  const totalItems = groupByName ? (groupedNetworks?.length || 0) : filteredNetworks.length;
  const itemCount = groupByName ? (groupedNetworks?.length || 0) : filteredNetworks.length;

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selectedNetworks.size === itemCount && itemCount > 0}
                  onCheckedChange={toggleAllNetworks}
                />
              </TableHead>
              {isColVisible("name") && (
                <TableHead className="cursor-pointer" onClick={() => handleSort("name")}>
                  <div className="flex items-center">Name {getSortIcon("name")}</div>
                </TableHead>
              )}
              {isColVisible("type") && (
                <TableHead className="cursor-pointer" onClick={() => handleSort("network_type")}>
                  <div className="flex items-center">Type {getSortIcon("network_type")}</div>
                </TableHead>
              )}
              {isColVisible("vlan") && (
                <TableHead className="cursor-pointer" onClick={() => handleSort("vlan_id")}>
                  <div className="flex items-center">VLAN {getSortIcon("vlan_id")}</div>
                </TableHead>
              )}
              {isColVisible("sites") && groupByName && (
                <TableHead className="cursor-pointer" onClick={() => handleSort("site_count")}>
                  <div className="flex items-center">Sites {getSortIcon("site_count")}</div>
                </TableHead>
              )}
              {isColVisible("switch") && !groupByName && (
                <TableHead className="cursor-pointer" onClick={() => handleSort("parent_switch_name")}>
                  <div className="flex items-center">Switch {getSortIcon("parent_switch_name")}</div>
                </TableHead>
              )}
              {isColVisible("hosts") && (
                <TableHead className="cursor-pointer text-right" onClick={() => handleSort("host_count")}>
                  <div className="flex items-center justify-end">Hosts {getSortIcon("host_count")}</div>
                </TableHead>
              )}
              {isColVisible("vms") && (
                <TableHead className="cursor-pointer text-right" onClick={() => handleSort("vm_count")}>
                  <div className="flex items-center justify-end">VMs {getSortIcon("vm_count")}</div>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(groupByName ? paginatedGroupedItems.length : paginatedFlatItems.length) === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Network className="h-8 w-8 opacity-50" />
                    <span>No networks found</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : groupByName ? (
              // Grouped view
              paginatedGroupedItems.map((group) => (
                <TableRow
                  key={group.name}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    if (group.networks.length > 0) {
                      onNetworkClick(group.networks[0]);
                    }
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedNetworks.has(group.name)}
                      onCheckedChange={() => toggleNetwork(group.name)}
                    />
                  </TableCell>
                  {isColVisible("name") && (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {group.networkType === 'distributed' ? (
                          <Network className="h-4 w-4 text-primary" />
                        ) : (
                          <Wifi className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium">{group.name}</span>
                      </div>
                    </TableCell>
                  )}
                  {isColVisible("type") && (
                    <TableCell>{getNetworkTypeBadge(group.networkType)}</TableCell>
                  )}
                  {isColVisible("vlan") && (
                    <TableCell>{getVlanDisplay(group.vlanId, group.vlanRange)}</TableCell>
                  )}
                  {isColVisible("sites") && (
                    <TableCell>
                      <Badge variant="secondary" className="gap-1">
                        <MapPin className="h-3 w-3" />
                        {group.siteCount} {group.siteCount === 1 ? 'site' : 'sites'}
                      </Badge>
                      {group.vcenterNames.length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {group.vcenterNames.slice(0, 2).join(', ')}
                          {group.vcenterNames.length > 2 && ` +${group.vcenterNames.length - 2}`}
                        </span>
                      )}
                    </TableCell>
                  )}
                  {isColVisible("hosts") && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Server className="h-3 w-3 text-muted-foreground" />
                        <span>{group.totalHostCount}</span>
                      </div>
                    </TableCell>
                  )}
                  {isColVisible("vms") && (
                    <TableCell className="text-right">{group.totalVmCount}</TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              // Flat view
              paginatedFlatItems.map((network) => (
                <TableRow
                  key={network.id}
                  className={`cursor-pointer ${selectedNetworkId === network.id ? 'bg-muted/50' : ''}`}
                  onClick={() => onNetworkClick(network)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedNetworks.has(network.id)}
                      onCheckedChange={() => toggleNetwork(network.id)}
                    />
                  </TableCell>
                  {isColVisible("name") && (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {network.network_type === 'distributed' ? (
                          <Network className="h-4 w-4 text-primary" />
                        ) : (
                          <Wifi className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium">{network.name}</span>
                      </div>
                    </TableCell>
                  )}
                  {isColVisible("type") && (
                    <TableCell>{getNetworkTypeBadge(network.network_type)}</TableCell>
                  )}
                  {isColVisible("vlan") && (
                    <TableCell>{getVlanDisplay(network.vlan_id, network.vlan_range)}</TableCell>
                  )}
                  {isColVisible("switch") && (
                    <TableCell>
                      {network.parent_switch_name ? (
                        <span className="text-sm">{network.parent_switch_name}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  )}
                  {isColVisible("hosts") && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Server className="h-3 w-3 text-muted-foreground" />
                        <span>{network.host_count || 0}</span>
                      </div>
                    </TableCell>
                  )}
                  {isColVisible("vms") && (
                    <TableCell className="text-right">{network.vm_count || 0}</TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={totalItems}
        startIndex={startIndex}
        endIndex={endIndex}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onFirstPage={goToFirstPage}
        onLastPage={goToLastPage}
        onNextPage={goToNextPage}
        onPrevPage={goToPrevPage}
        canGoNext={canGoNext}
        canGoPrev={canGoPrev}
      />
    </div>
  );
}
