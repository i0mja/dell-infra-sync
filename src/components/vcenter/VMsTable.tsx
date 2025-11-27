import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Power, PowerOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { VCenterVM } from "@/hooks/useVCenterData";

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

  // Get unique clusters
  const clusters = Array.from(new Set(vms.map((vm) => vm.cluster_name).filter(Boolean))).sort() as string[];

  // Filter VMs
  const filteredVms = vms.filter((vm) => {
    const matchesSearch =
      !searchTerm ||
      vm.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vm.ip_address?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vm.guest_os?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCluster = clusterFilter === "all" || vm.cluster_name === clusterFilter;
    const matchesPower = powerFilter === "all" || vm.power_state?.toLowerCase() === powerFilter;
    const matchesTools = toolsFilter === "all" || vm.tools_status?.toLowerCase() === toolsFilter;

    return matchesSearch && matchesCluster && matchesPower && matchesTools;
  });

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
        return <Badge variant="outline" className="text-xs">Unknown</Badge>;
    }
  };

  const getToolsStatusBadge = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case "toolsok":
        return <Badge variant="default" className="bg-success text-success-foreground text-xs">OK</Badge>;
      case "toolsold":
        return <Badge variant="outline" className="text-warning text-xs">Old</Badge>;
      case "toolsnotinstalled":
        return <Badge variant="destructive" className="text-xs">Not Installed</Badge>;
      case "toolsnotrunning":
        return <Badge variant="secondary" className="text-xs">Not Running</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status || "Unknown"}</Badge>;
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
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/50">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search VMs, IPs, OS..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Select value={clusterFilter} onValueChange={setClusterFilter}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue placeholder="All Clusters" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clusters</SelectItem>
            {clusters.map((cluster) => (
              <SelectItem key={cluster} value={cluster}>
                {cluster}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={powerFilter} onValueChange={setPowerFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Power State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="poweredon">Powered On</SelectItem>
            <SelectItem value="poweredoff">Powered Off</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>

        <Select value={toolsFilter} onValueChange={setToolsFilter}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="Tools Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tools</SelectItem>
            <SelectItem value="toolsok">OK</SelectItem>
            <SelectItem value="toolsold">Old</SelectItem>
            <SelectItem value="toolsnotinstalled">Not Installed</SelectItem>
            <SelectItem value="toolsnotrunning">Not Running</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-hidden flex flex-col flex-1 m-4">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-muted z-10">
              <TableRow>
                <TableHead className="w-[250px]">VM Name</TableHead>
                <TableHead className="w-[120px]">Power</TableHead>
                <TableHead className="w-[140px]">IP Address</TableHead>
                <TableHead className="w-[100px]">CPU/RAM</TableHead>
                <TableHead className="w-[80px]">Disk (GB)</TableHead>
                <TableHead className="w-[180px]">Guest OS</TableHead>
                <TableHead className="w-[120px]">Tools</TableHead>
                <TableHead className="w-[140px]">Cluster</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No VMs found matching the filters
                  </TableCell>
                </TableRow>
              ) : (
                filteredVms.map((vm) => (
                  <TableRow
                    key={vm.id}
                    className={`cursor-pointer ${
                      selectedVmId === vm.id ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                    onClick={() => onVmClick(vm)}
                  >
                    <TableCell className="font-medium">{vm.name}</TableCell>
                    <TableCell>{getPowerStateBadge(vm.power_state)}</TableCell>
                    <TableCell className="text-sm font-mono text-xs">
                      {vm.ip_address || "N/A"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {vm.cpu_count || 0} / {vm.memory_mb ? Math.round(vm.memory_mb / 1024) : 0}GB
                    </TableCell>
                    <TableCell className="text-sm">
                      {vm.disk_gb ? vm.disk_gb.toFixed(0) : "0"}
                    </TableCell>
                    <TableCell className="text-sm truncate max-w-[180px]">
                      {vm.guest_os || "Unknown"}
                    </TableCell>
                    <TableCell>{getToolsStatusBadge(vm.tools_status)}</TableCell>
                    <TableCell className="text-sm">{vm.cluster_name || "N/A"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t px-4 py-2 bg-muted/50 text-xs text-muted-foreground">
          Showing {filteredVms.length} of {vms.length} VMs
        </div>
      </div>
    </div>
  );
}
