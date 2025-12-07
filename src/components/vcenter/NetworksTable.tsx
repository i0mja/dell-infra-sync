import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { compareValues } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Network, Wifi, Server, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";
import type { VCenterNetwork } from "@/hooks/useVCenterData";

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
}: NetworksTableProps) {
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedNetworks, setSelectedNetworks] = useState<Set<string>>(new Set());

  const { visibleColumns, toggleColumn: localToggleColumn } = useColumnVisibility(
    "vcenter-networks-columns", 
    ["name", "type", "vlan", "switch", "hosts", "vms"]
  );

  const effectiveVisibleColumns = parentVisibleColumns || visibleColumns;
  const effectiveToggleColumn = onToggleColumn || localToggleColumn;
  const isColVisible = (col: string) => effectiveVisibleColumns.includes(col);

  let filteredNetworks = networks.filter((net) => {
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

  if (sortField) {
    filteredNetworks = [...filteredNetworks].sort((a, b) => {
      const aVal = a[sortField as keyof typeof a];
      const bVal = b[sortField as keyof typeof b];
      return compareValues(aVal, bVal, sortDirection);
    });
  }

  const pagination = usePagination(filteredNetworks, "vcenter-networks-pagination", 50);
  const { paginatedItems, currentPage, totalPages, pageSize, startIndex, endIndex, setPage, setPageSize, goToFirstPage, goToLastPage, goToNextPage, goToPrevPage, canGoNext, canGoPrev } = pagination;

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
    if (selectedNetworks.size === filteredNetworks.length) { 
      setSelectedNetworks(new Set()); 
    } else { 
      setSelectedNetworks(new Set(filteredNetworks.map((n) => n.id))); 
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

  const getVlanDisplay = (network: VCenterNetwork) => {
    if (network.vlan_range) {
      return <span className="text-xs font-mono">{network.vlan_range}</span>;
    }
    if (network.vlan_id) {
      return <Badge variant="outline" className="font-mono">{network.vlan_id}</Badge>;
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

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selectedNetworks.size === filteredNetworks.length && filteredNetworks.length > 0}
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
              {isColVisible("switch") && (
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
            {paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Network className="h-8 w-8 opacity-50" />
                    <span>No networks found</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((network) => (
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
                    <TableCell>{getVlanDisplay(network)}</TableCell>
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
        totalItems={filteredNetworks.length}
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