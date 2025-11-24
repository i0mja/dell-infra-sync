import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { useToast } from "@/hooks/use-toast";
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Layers,
  Link2,
  RefreshCcw,
  Server,
} from "lucide-react";
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
  const { toast } = useToast();

  const toggleCluster = (clusterName: string) => {
    const newCollapsed = new Set(collapsedClusters);
    if (newCollapsed.has(clusterName)) {
      newCollapsed.delete(clusterName);
    } else {
      newCollapsed.add(clusterName);
    }
    setCollapsedClusters(newCollapsed);
  };

  const copyToClipboard = async (value: string | null | undefined, label: string) => {
    if (!value) {
      toast({
        title: `No ${label.toLowerCase()} to copy`,
        description: `This host does not have a ${label.toLowerCase()} available yet.`,
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: `${label} copied`,
        description: value,
      });
    } catch (error: any) {
      toast({
        title: "Copy failed",
        description: error?.message || "Could not copy to clipboard", 
        variant: "destructive",
      });
    }
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
                    <ContextMenu key={host.id}>
                      <ContextMenuTrigger asChild>
                        <TableRow
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
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-72">
                        <ContextMenuItem
                          onClick={(event) => {
                            event.stopPropagation();
                            onHostClick(host);
                          }}
                        >
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
                              onClick={(event) => {
                                event.stopPropagation();
                                onViewLinkedServer?.(host);
                              }}
                            >
                              <Link2 className="mr-2 h-4 w-4" />
                              {host.server_id ? 'Open linked server' : 'No linked server'}
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                onLinkToServer?.(host);
                              }}
                            >
                              <Layers className="mr-2 h-4 w-4" />
                              Link or match server
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                copyToClipboard(host.serial_number, 'Serial number');
                              }}
                            >
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
                            <ContextMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                onClusterClick(host.cluster || 'Unclustered');
                              }}
                            >
                              <ChevronRight className="mr-2 h-4 w-4" />
                              View cluster summary
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                onClusterUpdate?.(host.cluster || undefined);
                              }}
                            >
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
                            <ContextMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                onHostSync?.(host);
                              }}
                            >
                              <RefreshCcw className="mr-2 h-4 w-4" />
                              Sync this host
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                copyToClipboard(host.vcenter_id, 'vCenter host ID');
                              }}
                            >
                              <ClipboardCopy className="mr-2 h-4 w-4" />
                              Copy vCenter host ID
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                copyToClipboard(host.name, 'Hostname');
                              }}
                            >
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
      
      <div className="border-t px-4 py-2 bg-muted/50 text-xs text-muted-foreground">
        Showing {clusterGroups.reduce((acc, g) => acc + g.hosts.length, 0)} hosts in {clusterGroups.length} cluster{clusterGroups.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
