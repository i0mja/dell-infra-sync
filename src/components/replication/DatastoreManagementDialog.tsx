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
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useDatastoreManagement } from '@/hooks/useDatastoreManagement';
import { useToast } from '@/hooks/use-toast';

interface VCenterHost {
  id: string;
  name: string;
  cluster: string | null;
  status: string;
}

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
  const [hosts, setHosts] = useState<VCenterHost[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const { 
    mountOnAllHosts, 
    mountOnHosts, 
    unmountFromHosts, 
    refreshMounts 
  } = useDatastoreManagement();
  const { toast } = useToast();

  // Fetch available hosts when dialog opens
  useEffect(() => {
    if (open && target?.dr_vcenter_id) {
      fetchHosts();
    }
  }, [open, target?.dr_vcenter_id]);

  const fetchHosts = async () => {
    if (!target?.dr_vcenter_id) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vcenter_hosts')
        .select('id, name, cluster, status')
        .eq('source_vcenter_id', target.dr_vcenter_id)
        .order('cluster', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      setHosts(data || []);
    } catch (error) {
      console.error('Failed to fetch hosts:', error);
      toast({
        title: "Failed to load hosts",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedHosts(new Set(hosts.map(h => h.name)));
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

  // Group hosts by cluster
  const hostsByCluster = hosts.reduce((acc, host) => {
    const cluster = host.cluster || 'Standalone Hosts';
    if (!acc[cluster]) acc[cluster] = [];
    acc[cluster].push(host);
    return acc;
  }, {} as Record<string, VCenterHost[]>);

  const datastoreName = target?.datastore_name || `nfs-${target?.name}`;
  const nfsPath = target?.nfs_export_path || `/${target?.zfs_pool}/nfs`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Manage Datastore Mounts
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
                <p className="font-medium">{datastoreName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">NFS Export</p>
                <p className="font-mono text-sm">{target.hostname}:{nfsPath}</p>
              </div>
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
                Mount on All Hosts
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
                Mount on Selected ({selectedHosts.size})
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
                  onClick={fetchHosts}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <ScrollArea className="h-[300px]">
                {loading ? (
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
                        <div className="px-4 py-2 bg-muted/20 text-xs font-medium text-muted-foreground">
                          {cluster}
                        </div>
                        {clusterHosts.map(host => (
                          <div
                            key={host.id}
                            className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors"
                          >
                            <Checkbox
                              checked={selectedHosts.has(host.name)}
                              onCheckedChange={() => handleToggleHost(host.name)}
                            />
                            <Server className="h-4 w-4 text-muted-foreground" />
                            <span className="flex-1 text-sm">{host.name}</span>
                            {host.status === 'connected' ? (
                              <Badge variant="secondary" className="text-xs">
                                <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                                Connected
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                <XCircle className="h-3 w-3 mr-1 text-destructive" />
                                {host.status}
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
