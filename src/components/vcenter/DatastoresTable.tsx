import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Search, HardDrive, Server, AlertTriangle } from "lucide-react";
import { useState } from "react";
import type { VCenterDatastore } from "@/hooks/useVCenterData";

interface DatastoresTableProps {
  datastores: VCenterDatastore[];
  selectedDatastoreId: string | null;
  onDatastoreClick: (datastore: VCenterDatastore) => void;
  loading: boolean;
}

export function DatastoresTable({ datastores, selectedDatastoreId, onDatastoreClick, loading }: DatastoresTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [accessFilter, setAccessFilter] = useState("all");

  // Get unique types
  const types = Array.from(new Set(datastores.map((ds) => ds.type).filter(Boolean))).sort() as string[];

  // Filter datastores
  const filteredDatastores = datastores.filter((ds) => {
    const matchesSearch = !searchTerm || ds.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "all" || ds.type === typeFilter;
    const matchesAccess =
      accessFilter === "all" ||
      (accessFilter === "accessible" && ds.accessible) ||
      (accessFilter === "inaccessible" && !ds.accessible);

    return matchesSearch && matchesType && matchesAccess;
  });

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
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/50">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search datastores..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {types.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={accessFilter} onValueChange={setAccessFilter}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="Accessibility" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="accessible">Accessible</SelectItem>
            <SelectItem value="inaccessible">Inaccessible</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-hidden flex flex-col flex-1 m-4">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-muted z-10">
              <TableRow>
                <TableHead className="w-[250px]">Name</TableHead>
                <TableHead className="w-[100px]">Type</TableHead>
                <TableHead className="w-[120px]">Capacity</TableHead>
                <TableHead className="w-[120px]">Free</TableHead>
                <TableHead className="w-[200px]">Usage</TableHead>
                <TableHead className="w-[80px]">Hosts</TableHead>
                <TableHead className="w-[80px]">VMs</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDatastores.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No datastores found matching the filters
                  </TableCell>
                </TableRow>
              ) : (
                filteredDatastores.map((datastore) => {
                  const usagePercent = getUsagePercent(datastore.capacity_bytes, datastore.free_bytes);
                  const isLowSpace = usagePercent >= 80;

                  return (
                    <TableRow
                      key={datastore.id}
                      className={`cursor-pointer ${
                        selectedDatastoreId === datastore.id ? "bg-accent" : "hover:bg-accent/50"
                      }`}
                      onClick={() => onDatastoreClick(datastore)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-4 w-4 text-muted-foreground" />
                          {datastore.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {datastore.type || "Unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatBytes(datastore.capacity_bytes)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatBytes(datastore.free_bytes)}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium">{usagePercent}% used</span>
                            {isLowSpace && (
                              <AlertTriangle className="h-3 w-3 text-warning" />
                            )}
                          </div>
                          <Progress
                            value={usagePercent}
                            className={`h-2 ${getUsageColor(usagePercent)}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-1">
                          <Server className="h-3 w-3 text-muted-foreground" />
                          {datastore.host_count || 0}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-1">
                          <HardDrive className="h-3 w-3 text-muted-foreground" />
                          {datastore.vm_count || 0}
                        </div>
                      </TableCell>
                      <TableCell>
                        {datastore.accessible ? (
                          <Badge variant="default" className="bg-success text-success-foreground text-xs">
                            Accessible
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            Inaccessible
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t px-4 py-2 bg-muted/50 text-xs text-muted-foreground">
          Showing {filteredDatastores.length} of {datastores.length} datastores
        </div>
      </div>
    </div>
  );
}
