import { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Columns3,
  Download,
  Search,
  MoreHorizontal,
  RefreshCw,
  Settings,
  Trash2,
  Network,
  Zap,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { compareValues } from "@/lib/utils";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { OutletStateIndicator } from "./OutletStateIndicator";
import { PduStatusBadge } from "./PduStatusBadge";
import type { Pdu, PduOutlet } from "@/types/pdu";

interface PdusTableProps {
  pdus: Pdu[];
  outlets: Map<string, PduOutlet[]>;
  selectedPduId: string | null;
  onPduClick: (pdu: Pdu) => void;
  onTest: (pdu: Pdu) => void;
  onSync: (pdu: Pdu) => void;
  onEdit: (pdu: Pdu) => void;
  onDelete: (pdu: Pdu) => void;
  onViewOutlets: (pdu: Pdu) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
}

type SortField = "name" | "ip_address" | "connection_status" | "protocol" | "model" | "total_outlets" | "datacenter" | "last_sync";

const DEFAULT_VISIBLE_COLUMNS = ["name", "ip_address", "connection_status", "protocol", "model", "total_outlets", "datacenter", "last_sync"];

export function PdusTable({
  pdus,
  outlets,
  selectedPduId,
  onPduClick,
  onTest,
  onSync,
  onEdit,
  onDelete,
  onViewOutlets,
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}: PdusTableProps) {
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedPdus, setSelectedPdus] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_VISIBLE_COLUMNS));

  // Filter and sort PDUs
  const filteredAndSortedPdus = useMemo(() => {
    let result = [...pdus];

    // Apply search filter
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(pdu =>
        pdu.name.toLowerCase().includes(lowerSearch) ||
        pdu.ip_address.toLowerCase().includes(lowerSearch) ||
        pdu.model?.toLowerCase().includes(lowerSearch) ||
        pdu.datacenter?.toLowerCase().includes(lowerSearch) ||
        pdu.rack_id?.toLowerCase().includes(lowerSearch)
      );
    }

    // Apply status filter
    if (statusFilter && statusFilter !== "all") {
      result = result.filter(pdu => pdu.connection_status === statusFilter);
    }

    // Apply sorting
    if (sortField) {
      result.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        return compareValues(aVal, bVal, sortDirection);
      });
    }

    return result;
  }, [pdus, searchTerm, statusFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
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

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3" />;
    return sortDirection === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const togglePduSelection = (pduId: string) => {
    const newSelected = new Set(selectedPdus);
    if (newSelected.has(pduId)) {
      newSelected.delete(pduId);
    } else {
      newSelected.add(pduId);
    }
    setSelectedPdus(newSelected);
  };

  const toggleAllPdus = () => {
    if (selectedPdus.size === filteredAndSortedPdus.length) {
      setSelectedPdus(new Set());
    } else {
      setSelectedPdus(new Set(filteredAndSortedPdus.map(p => p.id)));
    }
  };

  const toggleColumn = (column: string) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(column)) {
      newVisible.delete(column);
    } else {
      newVisible.add(column);
    }
    setVisibleColumns(newVisible);
  };

  const handleExportCSV = () => {
    const columns: ExportColumn<Pdu>[] = [
      { key: "name", label: "Name" },
      { key: "ip_address", label: "IP Address" },
      { key: "connection_status", label: "Status" },
      { key: "protocol", label: "Protocol" },
      { key: "model", label: "Model" },
      { key: "total_outlets", label: "Outlets" },
      { key: "datacenter", label: "Datacenter" },
      { key: "rack_id", label: "Rack" },
      { key: "last_sync", label: "Last Sync" },
    ];

    const pdusToExport = selectedPdus.size > 0
      ? filteredAndSortedPdus.filter(p => selectedPdus.has(p.id))
      : filteredAndSortedPdus;

    exportToCSV(pdusToExport, columns, "pdus");
  };

  // Render mini outlet grid (first 8 outlets)
  const renderOutletPreview = (pdu: Pdu) => {
    const pduOutlets = outlets.get(pdu.id) || [];
    const previewOutlets = pduOutlets.slice(0, 8);

    if (previewOutlets.length === 0) {
      return (
        <span className="text-muted-foreground text-xs">
          {pdu.total_outlets || 0} outlets
        </span>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <div className="flex gap-0.5">
          {previewOutlets.map((outlet) => (
            <OutletStateIndicator
              key={outlet.id}
              state={outlet.outlet_state}
              outletNumber={outlet.outlet_number}
              size="sm"
            />
          ))}
        </div>
        {pduOutlets.length > 8 && (
          <span className="text-muted-foreground text-xs">+{pduOutlets.length - 8}</span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 px-4 py-3 border-b sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search PDUs..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 h-8"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                Status: {statusFilter === "all" ? "All" : statusFilter || "All"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => onStatusFilterChange("all")}>All</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStatusFilterChange("online")}>Online</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStatusFilterChange("offline")}>Offline</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStatusFilterChange("unknown")}>Unknown</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStatusFilterChange("error")}>Error</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          {selectedPdus.size > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedPdus.size} selected
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Columns3 className="mr-1.5 h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {[
                { key: "name", label: "Name" },
                { key: "ip_address", label: "IP Address" },
                { key: "connection_status", label: "Status" },
                { key: "protocol", label: "Protocol" },
                { key: "model", label: "Model" },
                { key: "total_outlets", label: "Outlets" },
                { key: "datacenter", label: "Location" },
                { key: "last_sync", label: "Last Sync" },
              ].map(({ key, label }) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={visibleColumns.has(key)}
                  onCheckedChange={() => toggleColumn(key)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" className="h-8" onClick={handleExportCSV}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selectedPdus.size === filteredAndSortedPdus.length && filteredAndSortedPdus.length > 0}
                  onCheckedChange={toggleAllPdus}
                />
              </TableHead>
              {visibleColumns.has("name") && (
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-7 px-1" onClick={() => handleSort("name")}>
                    Name {getSortIcon("name")}
                  </Button>
                </TableHead>
              )}
              {visibleColumns.has("ip_address") && (
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-7 px-1" onClick={() => handleSort("ip_address")}>
                    IP Address {getSortIcon("ip_address")}
                  </Button>
                </TableHead>
              )}
              {visibleColumns.has("connection_status") && (
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-7 px-1" onClick={() => handleSort("connection_status")}>
                    Status {getSortIcon("connection_status")}
                  </Button>
                </TableHead>
              )}
              {visibleColumns.has("protocol") && (
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-7 px-1" onClick={() => handleSort("protocol")}>
                    Protocol {getSortIcon("protocol")}
                  </Button>
                </TableHead>
              )}
              {visibleColumns.has("model") && (
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-7 px-1" onClick={() => handleSort("model")}>
                    Model {getSortIcon("model")}
                  </Button>
                </TableHead>
              )}
              {visibleColumns.has("total_outlets") && (
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-7 px-1" onClick={() => handleSort("total_outlets")}>
                    Outlets {getSortIcon("total_outlets")}
                  </Button>
                </TableHead>
              )}
              {visibleColumns.has("datacenter") && (
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-7 px-1" onClick={() => handleSort("datacenter")}>
                    Location {getSortIcon("datacenter")}
                  </Button>
                </TableHead>
              )}
              {visibleColumns.has("last_sync") && (
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-7 px-1" onClick={() => handleSort("last_sync")}>
                    Last Sync {getSortIcon("last_sync")}
                  </Button>
                </TableHead>
              )}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedPdus.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No PDUs found</p>
                </TableCell>
              </TableRow>
            ) : (
              filteredAndSortedPdus.map((pdu) => (
                <ContextMenu key={pdu.id}>
                  <ContextMenuTrigger asChild>
                    <TableRow
                      className={`cursor-pointer hover:bg-muted/50 ${selectedPduId === pdu.id ? "bg-muted" : ""}`}
                      onClick={() => onPduClick(pdu)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedPdus.has(pdu.id)}
                          onCheckedChange={() => togglePduSelection(pdu.id)}
                        />
                      </TableCell>
                      {visibleColumns.has("name") && (
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{pdu.name}</span>
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.has("ip_address") && (
                        <TableCell className="font-mono text-sm">{pdu.ip_address}</TableCell>
                      )}
                      {visibleColumns.has("connection_status") && (
                        <TableCell>
                          <PduStatusBadge status={pdu.connection_status} />
                        </TableCell>
                      )}
                      {visibleColumns.has("protocol") && (
                        <TableCell>
                          <Badge variant="outline" className="text-xs uppercase">
                            {pdu.protocol || "auto"}
                          </Badge>
                        </TableCell>
                      )}
                      {visibleColumns.has("model") && (
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[160px]">
                          {pdu.model || "—"}
                        </TableCell>
                      )}
                      {visibleColumns.has("total_outlets") && (
                        <TableCell>{renderOutletPreview(pdu)}</TableCell>
                      )}
                      {visibleColumns.has("datacenter") && (
                        <TableCell className="text-sm text-muted-foreground">
                          {[pdu.datacenter, pdu.rack_id].filter(Boolean).join(" / ") || "—"}
                        </TableCell>
                      )}
                      {visibleColumns.has("last_sync") && (
                        <TableCell className="text-xs text-muted-foreground">
                          {pdu.last_sync
                            ? formatDistanceToNow(new Date(pdu.last_sync), { addSuffix: true })
                            : "Never"}
                        </TableCell>
                      )}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onTest(pdu)}>
                              <Network className="mr-2 h-4 w-4" />
                              Test Connection
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onSync(pdu)}>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Sync Status
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onViewOutlets(pdu)}>
                              <Zap className="mr-2 h-4 w-4" />
                              Control Outlets
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onEdit(pdu)}>
                              <Settings className="mr-2 h-4 w-4" />
                              Edit Settings
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onDelete(pdu)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => onTest(pdu)}>
                      <Network className="mr-2 h-4 w-4" />
                      Test Connection
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onSync(pdu)}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync Status
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onViewOutlets(pdu)}>
                      <Zap className="mr-2 h-4 w-4" />
                      Control Outlets
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => onEdit(pdu)}>
                      <Settings className="mr-2 h-4 w-4" />
                      Edit Settings
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => onDelete(pdu)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
