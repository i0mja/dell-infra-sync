import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

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
  loading: boolean;
}

export function HostsTable({
  clusterGroups,
  selectedHostId,
  selectedCluster,
  onHostClick,
  onClusterClick,
  loading,
}: HostsTableProps) {
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(new Set());

  const toggleCluster = (clusterName: string) => {
    const newCollapsed = new Set(collapsedClusters);
    if (newCollapsed.has(clusterName)) {
      newCollapsed.delete(clusterName);
    } else {
      newCollapsed.add(clusterName);
    }
    setCollapsedClusters(newCollapsed);
  };

  const getStatusBadge = (host: VCenterHost) => {
    if (host.maintenance_mode) {
      return <Badge variant="destructive" className="text-xs">Maintenance</Badge>;
    }
    
    switch (host.status?.toLowerCase()) {
      case 'connected':
        return <Badge variant="default" className="bg-success text-success-foreground text-xs">Connected</Badge>;
      case 'disconnected':
        return <Badge variant="destructive" className="text-xs">Disconnected</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">Unknown</Badge>;
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

  if (clusterGroups.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium mb-2">No hosts found</p>
          <p className="text-sm">Try adjusting your filters or sync vCenter data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-hidden flex flex-col h-full">
      <div className="overflow-auto flex-1">
        <Table>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              <TableHead className="w-[300px]">Hostname</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              <TableHead className="w-[120px]">ESXi Version</TableHead>
              <TableHead className="w-[160px]">Serial Number</TableHead>
              <TableHead className="w-[100px]">Linked</TableHead>
              <TableHead className="w-[140px]">Last Sync</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clusterGroups.map((cluster) => {
              const isCollapsed = collapsedClusters.has(cluster.name);
              const linkedCount = cluster.hosts.filter(h => h.server_id).length;
              const connectedCount = cluster.hosts.filter(h => h.status === 'connected').length;
              const isClusterSelected = selectedCluster === cluster.name;

              return (
                <>
                  {/* Cluster Header Row */}
                  <TableRow
                    key={`cluster-${cluster.name}`}
                    className={`cursor-pointer hover:bg-accent/50 font-medium ${
                      isClusterSelected ? 'bg-accent' : 'bg-muted/30'
                    }`}
                    onClick={() => {
                      toggleCluster(cluster.name);
                      onClusterClick(cluster.name);
                    }}
                  >
                    <TableCell colSpan={6} className="py-2">
                      <div className="flex items-center gap-2">
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                        <span className="font-semibold">{cluster.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({cluster.hosts.length} hosts, {linkedCount} linked, {connectedCount} connected)
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Host Rows */}
                  {!isCollapsed && cluster.hosts.map((host) => (
                    <TableRow
                      key={host.id}
                      className={`cursor-pointer ${
                        selectedHostId === host.id ? 'bg-accent' : 'hover:bg-accent/50'
                      }`}
                      onClick={() => onHostClick(host)}
                    >
                      <TableCell className="font-medium pl-8">{host.name}</TableCell>
                      <TableCell>{getStatusBadge(host)}</TableCell>
                      <TableCell className="text-sm">{host.esxi_version || 'N/A'}</TableCell>
                      <TableCell className="text-sm font-mono text-xs">
                        {host.serial_number || 'N/A'}
                      </TableCell>
                      <TableCell>
                        {host.server_id ? (
                          <Badge variant="secondary" className="text-xs">✓ Yes</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">✗ No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {host.last_sync 
                          ? formatDistanceToNow(new Date(host.last_sync), { addSuffix: true })
                          : 'Never'}
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      <div className="border-t px-4 py-2 bg-muted/50 text-xs text-muted-foreground">
        Showing {clusterGroups.reduce((acc, g) => acc + g.hosts.length, 0)} hosts in {clusterGroups.length} cluster{clusterGroups.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
