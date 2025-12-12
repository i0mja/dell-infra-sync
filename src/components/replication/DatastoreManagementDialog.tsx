import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  HardDrive,
  Server,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  AlertCircle,
  Download,
  Upload,
  Search,
  Clock,
} from 'lucide-react';
import { useDatastoreManagement } from '@/hooks/useDatastoreManagement';
import { useDatastoreStatus } from '@/hooks/useDatastoreStatus';
import { useQuickRefresh } from '@/hooks/useQuickRefresh';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';

interface DatastoreManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: {
    id: string;
    name: string;
    hostname: string;
    zfs_pool: string;
    datastore_name?: string | null;
    nfs_export_path?: string | null;
    dr_vcenter_id?: string | null;
  } | null;
}

export function DatastoreManagementDialog({
  open,
  onOpenChange,
  target,
}: DatastoreManagementDialogProps) {
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const datastoreName = target?.datastore_name || `nfs-${target?.name}`;
  const nfsPath = target?.nfs_export_path || `/${target?.zfs_pool}/nfs`;
  
  const { 
    mountOnAllHosts, 
    mountOnHosts, 
    unmountFromHosts, 
    refreshMounts,
    scanDatastoreStatus,
  } = useDatastoreManagement();
  
  const {
    status,
    loading: statusLoading,
    refetch: refetchStatus,
  } = useDatastoreStatus(
    target?.id || null,
    target?.dr_vcenter_id || null,
    datastoreName
  );
  
  const {
    isRefreshing,
    triggerQuickRefresh,
    lastRefresh,
  } = useQuickRefresh(target?.dr_vcenter_id || null);
  
  const { toast } = useToast();

  // Trigger quick refresh when dialog opens
  useEffect(() => {
    if (open && target?.dr_vcenter_id) {
      triggerQuickRefresh(['datastores', 'hosts']);
    }
  }, [open, target?.dr_vcenter_id]);

  // Refetch status after quick refresh completes
  useEffect(() => {
    if (lastRefresh) {
      refetchStatus();
    }
  }, [lastRefresh, refetchStatus]);

  // Reset selection when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedHosts(new Set());
    }
  }, [open]);

  const hosts = status?.hosts || [];
  const mountedCount = status?.mounted_count || 0;
  const totalHosts = status?.total_hosts || 0;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedHosts(new Set(hosts.map(h => h.host_name)));
    } else {
      setSelectedHosts(new Set());
    }
  };

  const handleToggleHost = (hostName: string) => {
    const newSelected = new Set(selectedHosts);
    if (newSelected.has(hostName)) {
      newSelected.delete(hostName);
    } else {
      newSelected.add(hostName);
    }
    setSelectedHosts(newSelected);
  };

  const handleMountAll = async () => {
    if (!target) return;
    setActionLoading('mount_all');
    try {
      await mountOnAllHosts(target.id);
      toast({
        title: "Mount job created",
        description: "Datastore will be mounted on all ESXi hosts",
      });
      onOpenChange(false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleMountSelected = async () => {
    if (!target || selectedHosts.size === 0) return;
    setActionLoading('mount_selected');
    try {
      await mountOnHosts(target.id, Array.from(selectedHosts));
      toast({
        title: "Mount job created",
        description: `Datastore will be mounted on ${selectedHosts.size} hosts`,
      });
      onOpenChange(false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnmountSelected = async () => {
    if (!target || selectedHosts.size === 0) return;
    setActionLoading('unmount_selected');
    try {
      await unmountFromHosts(target.id, Array.from(selectedHosts));
      toast({
        title: "Unmount job created",
        description: `Datastore will be unmounted from ${selectedHosts.size} hosts`,
      });
      onOpenChange(false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRefresh = async () => {
    if (!target) return;
    setActionLoading('refresh');
    try {
      await refreshMounts(target.id);
      toast({
        title: "Refresh job created",
        description: "Datastore mounts will be refreshed on all hosts",
      });
      onOpenChange(false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleScanNow = async () => {
    if (!target) return;
    setActionLoading('scan');
    try {
      await scanDatastoreStatus(target.id);
      toast({
        title: "Scan job created",
        description: "Scanning datastore mount status from vCenter",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleQuickRefresh = () => {
    if (target?.dr_vcenter_id) {
      triggerQuickRefresh(['datastores', 'hosts']);
    }
  };

  // Group hosts by cluster
  const hostsByCluster = hosts.reduce((acc, host) => {
    const cluster = host.cluster || 'Standalone Hosts';
    if (!acc[cluster]) acc[cluster] = [];
    acc[cluster].push(host);
    return acc;
  }, {} as Record<string, typeof hosts>);

  const isLoading = statusLoading || isRefreshing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Manage Datastore Mounts
            {isRefreshing && (
              <Badge variant="secondary" className="ml-2 text-xs">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Syncing
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Mount or unmount the NFS datastore on ESXi hosts
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="space-y-4">
            {/* Target Info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">Datastore Name</p>
                <p className="font-medium">{status?.datastore_name || datastoreName}</p>
                {status?.datastore_id && (
                  <Badge variant="outline" className="mt-1 text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                    Linked
                  </Badge>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">NFS Export</p>
                <p className="font-mono text-sm">{target.hostname}:{nfsPath}</p>
              </div>
            </div>

            {/* Mount Status Summary */}
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold">{mountedCount}</p>
                  <p className="text-xs text-muted-foreground">Mounted</p>
                </div>
                <div className="text-muted-foreground">/</div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{totalHosts}</p>
                  <p className="text-xs text-muted-foreground">Total Hosts</p>
                </div>
              </div>
              {lastRefresh && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Synced {formatDistanceToNow(lastRefresh, { addSuffix: true })}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleMountAll}
                disabled={!!actionLoading}
              >
                {actionLoading === 'mount_all' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Mount All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleMountSelected}
                disabled={!!actionLoading || selectedHosts.size === 0}
              >
                {actionLoading === 'mount_selected' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Mount Selected ({selectedHosts.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnmountSelected}
                disabled={!!actionLoading || selectedHosts.size === 0}
              >
                {actionLoading === 'unmount_selected' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Unmount Selected
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={!!actionLoading}
              >
                {actionLoading === 'refresh' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Refresh All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleScanNow}
                disabled={!!actionLoading}
                title="Live scan from vCenter"
              >
                {actionLoading === 'scan' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Host List */}
            <div className="border rounded-lg">
              <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedHosts.size === hosts.length && hosts.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                  <span className="text-sm font-medium">ESXi Hosts</span>
                  <Badge variant="secondary">{hosts.length}</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleQuickRefresh}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <ScrollArea className="h-[300px]">
                {isLoading && hosts.length === 0 ? (
                  <div className="p-4 space-y-3">
                    {[1, 2, 3, 4, 5].map(i => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : hosts.length === 0 ? (
                  <div className="p-8 text-center">
                    <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">
                      {target.dr_vcenter_id 
                        ? "No hosts found in vCenter" 
                        : "No vCenter assigned to this target"}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {Object.entries(hostsByCluster).map(([cluster, clusterHosts]) => (
                      <div key={cluster}>
                        <div className="px-4 py-2 bg-muted/20 text-xs font-medium text-muted-foreground flex items-center justify-between">
                          <span>{cluster}</span>
                          <span>
                            {clusterHosts.filter(h => h.mounted).length}/{clusterHosts.length} mounted
                          </span>
                        </div>
                        {clusterHosts.map(host => (
                          <div
                            key={host.host_id}
                            className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors"
                          >
                            <Checkbox
                              checked={selectedHosts.has(host.host_name)}
                              onCheckedChange={() => handleToggleHost(host.host_name)}
                            />
                            <Server className="h-4 w-4 text-muted-foreground" />
                            <span className="flex-1 text-sm">{host.host_name}</span>
                            
                            {/* Connection Status */}
                            {!host.connected && (
                              <Badge variant="outline" className="text-xs">
                                <XCircle className="h-3 w-3 mr-1 text-destructive" />
                                Disconnected
                              </Badge>
                            )}
                            
                            {/* Mount Status */}
                            {host.mounted ? (
                              <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Mounted
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                <XCircle className="h-3 w-3 mr-1 text-muted-foreground" />
                                Not Mounted
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            <div className="text-xs text-muted-foreground">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              Select hosts and use the buttons above to mount or unmount the datastore.
              Jobs are processed by the Job Executor.
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
