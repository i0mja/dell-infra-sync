import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  XCircle,
  Layers,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";
import type { VCenterCluster } from "@/hooks/useVCenterData";
import { toast } from "sonner";

interface ClustersTableProps {
  clusters: VCenterCluster[];
  selectedClusterId: string | null;
  onClusterClick: (clusterId: string) => void;
  loading: boolean;
  searchTerm: string;
  statusFilter: string;
  haFilter: string;
  drsFilter: string;
  onExport?: () => void;
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
}

export function ClustersTable({
  clusters,
  selectedClusterId,
  onClusterClick,
  loading,
  searchTerm,
  statusFilter,
  haFilter,
  drsFilter,
  onExport,
  visibleColumns: parentVisibleColumns,
  onToggleColumn,
}: ClustersTableProps) {
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set());

  const { visibleColumns, isColumnVisible, toggleColumn: localToggleColumn } = useColumnVisibility(
    "vcenter-clusters-columns",
    ["name", "status", "hosts", "vms", "ha", "drs", "cpu", "memory", "storage", "sync"]
  );

  const effectiveVisibleColumns = parentVisibleColumns || visibleColumns;
  const effectiveToggleColumn = onToggleColumn || localToggleColumn;
  const isColVisible = (col: string) => effectiveVisibleColumns.includes(col);

  // Filter clusters
  const filteredClusters = clusters.filter((cluster) => {
    const matchesSearch = cluster.cluster_name.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || cluster.overall_status?.toLowerCase() === statusFilter;
    const matchesHa = haFilter === "all" || 
      (haFilter === "enabled" && cluster.ha_enabled) ||
      (haFilter === "disabled" && !cluster.ha_enabled);
    const matchesDrs = drsFilter === "all" || 
      (drsFilter === "enabled" && cluster.drs_enabled) ||
      (drsFilter === "disabled" && !cluster.drs_enabled);

    return matchesSearch && matchesStatus && matchesHa && matchesDrs;
  });

  // Apply sorting
  const sortedClusters = sortField
    ? [...filteredClusters].sort((a, b) => {
        let aVal: any = a[sortField as keyof VCenterCluster];
        let bVal: any = b[sortField as keyof VCenterCluster];

        // Special handling for usage percentages
        if (sortField === "cpu_usage") {
          aVal = getUsagePercent(a.used_cpu_mhz, a.total_cpu_mhz);
          bVal = getUsagePercent(b.used_cpu_mhz, b.total_cpu_mhz);
        } else if (sortField === "memory_usage") {
          aVal = getUsagePercent(a.used_memory_bytes, a.total_memory_bytes);
          bVal = getUsagePercent(b.used_memory_bytes, b.total_memory_bytes);
        } else if (sortField === "storage_usage") {
          aVal = getUsagePercent(a.used_storage_bytes, a.total_storage_bytes);
          bVal = getUsagePercent(b.used_storage_bytes, b.total_storage_bytes);
        }

        if (aVal == null) return 1;
        if (bVal == null) return -1;

        const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        return sortDirection === "asc" ? comparison : -comparison;
      })
    : filteredClusters;

  // Pagination
  const pagination = usePagination(sortedClusters, "vcenter-clusters-pagination", 50);

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

  const toggleClusterSelection = (clusterId: string) => {
    const newSelected = new Set(selectedClusters);
    if (newSelected.has(clusterId)) {
      newSelected.delete(clusterId);
    } else {
      newSelected.add(clusterId);
    }
    setSelectedClusters(newSelected);
  };

  const toggleAllClusters = () => {
    if (selectedClusters.size === sortedClusters.length) {
      setSelectedClusters(new Set());
    } else {
      setSelectedClusters(new Set(sortedClusters.map((c) => c.id)));
    }
  };

  const handleExportCSV = () => {
    if (onExport) {
      onExport();
      return;
    }
    const columns: ExportColumn<VCenterCluster>[] = [
      { key: "cluster_name", label: "Cluster Name" },
      { key: "overall_status", label: "Status" },
      { key: "host_count", label: "Hosts" },
      { key: "vm_count", label: "VMs" },
      { key: "ha_enabled", label: "HA Enabled", format: (v) => (v ? "Yes" : "No") },
      { key: "drs_enabled", label: "DRS Enabled", format: (v) => (v ? "Yes" : "No") },
      { key: "drs_automation_level", label: "DRS Automation" },
      {
        key: "used_cpu_mhz",
        label: "CPU Usage %",
        format: (_, row) => `${getUsagePercent(row.used_cpu_mhz, row.total_cpu_mhz)}%`,
      },
      {
        key: "used_memory_bytes",
        label: "Memory Usage %",
        format: (_, row) => `${getUsagePercent(row.used_memory_bytes, row.total_memory_bytes)}%`,
      },
      {
        key: "used_storage_bytes",
        label: "Storage Usage %",
        format: (_, row) => `${getUsagePercent(row.used_storage_bytes, row.total_storage_bytes)}%`,
      },
      { key: "last_sync", label: "Last Sync" },
    ];

    const clustersToExport =
      selectedClusters.size > 0
        ? sortedClusters.filter((c) => selectedClusters.has(c.id))
        : sortedClusters;

    exportToCSV(clustersToExport, columns, "vcenter-clusters");
    toast.success(`Exported ${clustersToExport.length} clusters`);
  };

  const getStatusColor = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case "green":
        return "bg-success text-success-foreground";
      case "yellow":
        return "bg-warning text-warning-foreground";
      case "red":
        return "bg-destructive text-destructive-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return "0 TB";
    const tb = bytes / 1024 ** 4;
    return `${tb.toFixed(1)} TB`;
  };

  const getUsagePercent = (used: number | null, total: number | null) => {
    if (!used || !total) return 0;
    return Math.round((used / total) * 100);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          Loading clusters...
        </div>
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <Layers className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium mb-2">No clusters found</p>
          <p className="text-sm">Sync vCenter data to see clusters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Table */}
      <div className="overflow-auto flex-1">
        <Table>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={selectedClusters.size === sortedClusters.length}
                  onCheckedChange={toggleAllClusters}
                />
              </TableHead>
              {isColumnVisible("name") && (
                <TableHead
                  className="w-[220px] cursor-pointer"
                  onClick={() => handleSort("cluster_name")}
                >
                  <div className="flex items-center">
                    Cluster Name {getSortIcon("cluster_name")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("status") && (
                <TableHead
                  className="w-[100px] cursor-pointer"
                  onClick={() => handleSort("overall_status")}
                >
                  <div className="flex items-center">
                    Status {getSortIcon("overall_status")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("hosts") && (
                <TableHead
                  className="w-[80px] cursor-pointer"
                  onClick={() => handleSort("host_count")}
                >
                  <div className="flex items-center">
                    Hosts {getSortIcon("host_count")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("vms") && (
                <TableHead
                  className="w-[80px] cursor-pointer"
                  onClick={() => handleSort("vm_count")}
                >
                  <div className="flex items-center">
                    VMs {getSortIcon("vm_count")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("ha") && (
                <TableHead
                  className="w-[80px] cursor-pointer"
                  onClick={() => handleSort("ha_enabled")}
                >
                  <div className="flex items-center">
                    HA {getSortIcon("ha_enabled")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("drs") && (
                <TableHead
                  className="w-[140px] cursor-pointer"
                  onClick={() => handleSort("drs_enabled")}
                >
                  <div className="flex items-center">
                    DRS {getSortIcon("drs_enabled")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("cpu") && (
                <TableHead
                  className="w-[140px] cursor-pointer"
                  onClick={() => handleSort("cpu_usage")}
                >
                  <div className="flex items-center">
                    CPU Usage {getSortIcon("cpu_usage")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("memory") && (
                <TableHead
                  className="w-[140px] cursor-pointer"
                  onClick={() => handleSort("memory_usage")}
                >
                  <div className="flex items-center">
                    Memory Usage {getSortIcon("memory_usage")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("storage") && (
                <TableHead
                  className="w-[180px] cursor-pointer"
                  onClick={() => handleSort("storage_usage")}
                >
                  <div className="flex items-center">
                    Storage Usage {getSortIcon("storage_usage")}
                  </div>
                </TableHead>
              )}
              {isColumnVisible("sync") && (
                <TableHead
                  className="w-[140px] cursor-pointer"
                  onClick={() => handleSort("last_sync")}
                >
                  <div className="flex items-center">
                    Last Sync {getSortIcon("last_sync")}
                  </div>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.paginatedItems.map((cluster) => {
              const isSelected = selectedClusterId === cluster.id;
              const cpuPercent = getUsagePercent(cluster.used_cpu_mhz, cluster.total_cpu_mhz);
              const memoryPercent = getUsagePercent(
                cluster.used_memory_bytes,
                cluster.total_memory_bytes
              );
              const storagePercent = getUsagePercent(
                cluster.used_storage_bytes,
                cluster.total_storage_bytes
              );

              return (
                <TableRow
                  key={cluster.id}
                  className={`cursor-pointer ${
                    isSelected ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                  onClick={() => onClusterClick(cluster.id)}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedClusters.has(cluster.id)}
                      onCheckedChange={() => toggleClusterSelection(cluster.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  {isColumnVisible("name") && (
                    <TableCell className="font-medium">{cluster.cluster_name}</TableCell>
                  )}
                  {isColumnVisible("status") && (
                    <TableCell>
                      <Badge className={getStatusColor(cluster.overall_status)}>
                        {cluster.overall_status || "Unknown"}
                      </Badge>
                    </TableCell>
                  )}
                  {isColumnVisible("hosts") && (
                    <TableCell className="text-center">{cluster.host_count || 0}</TableCell>
                  )}
                  {isColumnVisible("vms") && (
                    <TableCell className="text-center">{cluster.vm_count || 0}</TableCell>
                  )}
                  {isColumnVisible("ha") && (
                    <TableCell>
                      {cluster.ha_enabled ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                  )}
                  {isColumnVisible("drs") && (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {cluster.drs_enabled ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                        {cluster.drs_enabled && cluster.drs_automation_level && (
                          <Badge variant="outline" className="text-xs">
                            {cluster.drs_automation_level}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  )}
                  {isColumnVisible("cpu") && (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={cpuPercent}
                          className="h-2 flex-1"
                        />
                        <span className="text-xs text-muted-foreground w-10 text-right">
                          {cpuPercent}%
                        </span>
                      </div>
                    </TableCell>
                  )}
                  {isColumnVisible("memory") && (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={memoryPercent}
                          className="h-2 flex-1"
                        />
                        <span className="text-xs text-muted-foreground w-10 text-right">
                          {memoryPercent}%
                        </span>
                      </div>
                    </TableCell>
                  )}
                  {isColumnVisible("storage") && (
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Progress
                            value={storagePercent}
                            className="h-2 flex-1"
                          />
                          <span className="text-xs text-muted-foreground w-10 text-right">
                            {storagePercent}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(cluster.used_storage_bytes)} /{" "}
                          {formatBytes(cluster.total_storage_bytes)}
                        </p>
                      </div>
                    </TableCell>
                  )}
                  {isColumnVisible("sync") && (
                    <TableCell className="text-xs text-muted-foreground">
                      {cluster.last_sync
                        ? formatDistanceToNow(new Date(cluster.last_sync), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="border-t bg-card">
        <TablePagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalItems={sortedClusters.length}
          startIndex={pagination.startIndex}
          endIndex={pagination.endIndex}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          canGoPrev={pagination.canGoPrev}
          canGoNext={pagination.canGoNext}
          onPrevPage={pagination.goToPrevPage}
          onNextPage={pagination.goToNextPage}
          onFirstPage={pagination.goToFirstPage}
          onLastPage={pagination.goToLastPage}
        />
      </div>
    </div>
  );
}
