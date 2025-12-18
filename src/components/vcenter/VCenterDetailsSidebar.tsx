import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { X, RefreshCcw, Link2, ExternalLink, Star, Loader2, HardDrive, CheckCircle2, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DatastoreVM } from "@/hooks/useDatastoreVMs";
import { ClusterDatastore } from "@/hooks/useClusterDatastores";

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

interface VCenterDetailsSidebarProps {
  selectedHost: VCenterHost | null;
  selectedCluster: ClusterGroup | null;
  selectedVm?: any;
  selectedClusterData?: any;
  selectedDatastore?: any;
  datastoreVMs?: DatastoreVM[];
  datastoreVMsLoading?: boolean;
  clusterDatastores?: ClusterDatastore[];
  clusterDatastoresLoading?: boolean;
  onClusterUpdate: (clusterName?: string) => void;
  onClose: () => void;
  onHostSync?: (host: VCenterHost) => void;
  onViewLinkedServer?: (host: VCenterHost) => void;
  onLinkToServer?: (host: VCenterHost) => void;
  onNavigateToVM?: (vmId: string) => void;
  onNavigateToDatastore?: (datastoreId: string) => void;
}

// Helper to format bytes to human-readable
function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function VCenterDetailsSidebar({
  selectedHost,
  selectedCluster,
  selectedVm,
  selectedClusterData,
  selectedDatastore,
  datastoreVMs,
  datastoreVMsLoading,
  clusterDatastores,
  clusterDatastoresLoading,
  onClusterUpdate,
  onClose,
  onHostSync,
  onViewLinkedServer,
  onLinkToServer,
  onNavigateToVM,
  onNavigateToDatastore,
}: VCenterDetailsSidebarProps) {
  
  // VM Details View
  if (selectedVm) {
    return (
      <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">VM Details</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">VM Information</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="text-sm font-medium">{selectedVm.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Power State</p>
                  <p className="text-sm font-medium">{selectedVm.power_state || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">IP Address</p>
                  <p className="text-sm font-mono">{selectedVm.ip_address || "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Guest OS</p>
                  <p className="text-sm">{selectedVm.guest_os || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cluster</p>
                  <p className="text-sm">{selectedVm.cluster_name || "N/A"}</p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Resources</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">CPU</p>
                  <p className="text-sm font-medium">{selectedVm.cpu_count || 0} vCPUs</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Memory</p>
                  <p className="text-sm font-medium">
                    {selectedVm.memory_mb ? `${Math.round(selectedVm.memory_mb / 1024)} GB` : "0 GB"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Disk</p>
                  <p className="text-sm font-medium">
                    {selectedVm.disk_gb ? `${selectedVm.disk_gb.toFixed(0)} GB` : "0 GB"}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">VMware Tools</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="text-sm font-medium">{selectedVm.tools_status || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Version</p>
                  <p className="text-sm">{selectedVm.tools_version || "N/A"}</p>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Cluster Data Details View
  if (selectedClusterData) {
    return (
      <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Cluster Details</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Cluster Information</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="text-sm font-medium">{selectedClusterData.cluster_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="text-sm font-medium">{selectedClusterData.overall_status || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Hosts</p>
                  <p className="text-sm">{selectedClusterData.host_count || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">VMs</p>
                  <p className="text-sm">{selectedClusterData.vm_count || 0}</p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Features</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">HA Enabled</p>
                  <p className="text-sm">{selectedClusterData.ha_enabled ? "Yes" : "No"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">DRS Enabled</p>
                  <p className="text-sm">{selectedClusterData.drs_enabled ? "Yes" : "No"}</p>
                </div>
                {selectedClusterData.drs_enabled && (
                  <div>
                    <p className="text-xs text-muted-foreground">DRS Automation</p>
                    <p className="text-sm">{selectedClusterData.drs_automation_level || "N/A"}</p>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Actions</h3>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => onClusterUpdate(selectedClusterData.cluster_name)}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Cluster Update
              </Button>
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Datastores ({clusterDatastores?.length || 0})
                </h3>
                {clusterDatastores && clusterDatastores.length > 0 && onNavigateToDatastore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => onNavigateToDatastore(clusterDatastores[0].id)}
                  >
                    View All
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                )}
              </div>

              {clusterDatastoresLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : clusterDatastores && clusterDatastores.length > 0 ? (
                <div className="space-y-2 pr-1">
                  {clusterDatastores.map((ds) => {
                    const usagePercent = ds.capacity_bytes && ds.free_bytes
                      ? Math.round(((ds.capacity_bytes - ds.free_bytes) / ds.capacity_bytes) * 100)
                      : 0;
                    return (
                      <button
                        key={ds.id}
                        onClick={() => onNavigateToDatastore?.(ds.id)}
                        className="w-full flex flex-col gap-1 p-2 rounded-md hover:bg-muted/50 transition-colors text-left group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <HardDrive className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm truncate flex-1">{ds.name}</span>
                          {ds.is_shared ? (
                            <span title="Shared by all hosts">
                              <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
                            </span>
                          ) : (
                            <span title={`Accessible by ${ds.accessible_host_count}/${ds.total_cluster_hosts} hosts`}>
                              <AlertCircle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 pl-5">
                          <Badge variant="outline" className="text-[10px] h-4 px-1">
                            {ds.type || "Unknown"}
                          </Badge>
                          <div className="flex-1 flex items-center gap-1">
                            <Progress value={usagePercent} className={`h-1.5 flex-1 ${usagePercent >= 90 ? "bg-destructive/20" : usagePercent >= 80 ? "bg-warning/20" : ""}`} />
                            <span className="text-[10px] text-muted-foreground w-8">{usagePercent}%</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No datastores accessible by this cluster</p>
              )}

              {clusterDatastores && clusterDatastores.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-2 flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> Shared
                  </span>
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 text-warning" /> Partial
                  </span>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Datastore Details View
  if (selectedDatastore) {
    const usagePercent = selectedDatastore.capacity_bytes && selectedDatastore.free_bytes
      ? Math.round(((selectedDatastore.capacity_bytes - selectedDatastore.free_bytes) / selectedDatastore.capacity_bytes) * 100)
      : 0;

    return (
      <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Datastore Details</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Datastore Information</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="text-sm font-medium">{selectedDatastore.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="text-sm">{selectedDatastore.type || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Accessible</p>
                  <p className="text-sm">{selectedDatastore.accessible ? "Yes" : "No"}</p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Capacity</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Total Capacity</p>
                  <p className="text-sm font-medium">
                    {selectedDatastore.capacity_bytes 
                      ? `${(selectedDatastore.capacity_bytes / (1024 ** 4)).toFixed(2)} TB`
                      : "0 TB"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Free Space</p>
                  <p className="text-sm font-medium">
                    {selectedDatastore.free_bytes
                      ? `${(selectedDatastore.free_bytes / (1024 ** 4)).toFixed(2)} TB`
                      : "0 TB"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Usage</p>
                  <p className="text-sm font-medium">{usagePercent}%</p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Usage</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Hosts</p>
                  <p className="text-sm">{selectedDatastore.host_count || 0}</p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Virtual Machines ({datastoreVMs?.length || selectedDatastore.vm_count || 0})
                </h3>
                {datastoreVMs && datastoreVMs.length > 0 && onNavigateToVM && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => onNavigateToVM(datastoreVMs[0].id)}
                  >
                    View All
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                )}
              </div>

              {datastoreVMsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : datastoreVMs && datastoreVMs.length > 0 ? (
                <div className="space-y-2 pr-1">
                  {datastoreVMs.map((vm) => (
                    <button
                      key={vm.id}
                      onClick={() => onNavigateToVM?.(vm.id)}
                      className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${
                            vm.power_state === "poweredOn"
                              ? "bg-green-500"
                              : vm.power_state === "poweredOff"
                              ? "bg-red-500"
                              : "bg-yellow-500"
                          }`}
                        />
                        <span className="text-sm truncate">{vm.name}</span>
                        {vm.is_primary_datastore && (
                          <Star className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                        {formatBytes(vm.committed_bytes)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No VMs on this datastore</p>
              )}

              {datastoreVMs && datastoreVMs.some((vm) => vm.is_primary_datastore) && (
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <Star className="h-3 w-3 text-yellow-500" /> Primary datastore
                </p>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Host Details View
  if (selectedHost) {
    return (
      <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Host Details</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">ESXi Host</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Hostname</p>
                  <p className="text-sm font-medium">{selectedHost.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cluster</p>
                  <p className="text-sm">{selectedHost.cluster || "Unclustered"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant={selectedHost.status === "connected" ? "default" : "destructive"} className="text-xs">
                    {selectedHost.maintenance_mode ? "Maintenance Mode" : selectedHost.status || "Unknown"}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ESXi Version</p>
                  <p className="text-sm">{selectedHost.esxi_version || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Serial Number</p>
                  <p className="text-sm font-mono">{selectedHost.serial_number || "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">vCenter ID</p>
                  <p className="text-sm font-mono text-xs">{selectedHost.vcenter_id || "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Sync</p>
                  <p className="text-sm">
                    {selectedHost.last_sync ? formatDistanceToNow(new Date(selectedHost.last_sync), { addSuffix: true }) : "Never"}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Physical Server</h3>
              {selectedHost.server_id ? (
                <div className="space-y-3">
                  <Badge variant="secondary" className="text-xs">
                    <Link2 className="mr-1 h-3 w-3" />
                    Linked to physical server
                  </Badge>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={() => onViewLinkedServer?.(selectedHost)}
                  >
                    View Physical Server
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Not linked to a physical server</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={() => onLinkToServer?.(selectedHost)}
                  >
                    Link to Server
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Actions</h3>
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full"
                onClick={() => onHostSync?.(selectedHost)}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Sync This Host
              </Button>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Cluster Summary View
  if (selectedCluster) {
    const linkedHosts = selectedCluster.hosts.filter((h) => h.server_id).length;
    const connectedHosts = selectedCluster.hosts.filter((h) => h.status === "connected").length;

    return (
      <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Cluster Summary</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Cluster: {selectedCluster.name}</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Total Hosts</p>
                  <p className="text-sm font-medium">{selectedCluster.hosts.length}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Linked Hosts</p>
                  <p className="text-sm font-medium">{linkedHosts}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Connected Hosts</p>
                  <p className="text-sm font-medium">{connectedHosts}</p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Actions</h3>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => onClusterUpdate(selectedCluster.name)}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Rolling Cluster Update
              </Button>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Default/Empty State
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Details</h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center justify-center p-8 text-center h-full">
          <div className="rounded-full bg-muted p-3 mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M7 7h10" />
              <path d="M7 12h10" />
              <path d="M7 17h10" />
            </svg>
          </div>
          <h3 className="text-sm font-medium mb-2">No Selection</h3>
          <p className="text-sm text-muted-foreground max-w-[240px]">
            Select a host, VM, cluster, or datastore to view details and available actions.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
