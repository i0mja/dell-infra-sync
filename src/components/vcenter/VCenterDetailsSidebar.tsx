import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { 
  X, RefreshCcw, Link2, ExternalLink, Star, Loader2, HardDrive, 
  CheckCircle2, AlertCircle, Server, MonitorDot, Cpu, MemoryStick,
  Database, Shield, Shuffle, Settings2, Eye, ShieldCheck, Activity
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DatastoreVM } from "@/hooks/useDatastoreVMs";
import { ClusterDatastore } from "@/hooks/useClusterDatastores";
import { VMDetailsSidebar } from "./VMDetailsSidebar";
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
  onNavigateToHost?: (hostId: string) => void;
  onSafetyCheck?: (clusterName: string) => void;
  onNavigateToHosts?: (clusterName: string) => void;
  onNavigateToVMs?: (clusterName: string) => void;
}

// Helper to format bytes to human-readable
function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// Get status color for the header bar
function getStatusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'green':
    case 'connected':
      return 'bg-success';
    case 'yellow':
    case 'warning':
      return 'bg-warning';
    case 'red':
    case 'error':
    case 'disconnected':
      return 'bg-destructive';
    default:
      return 'bg-muted';
  }
}

// Get progress bar color based on usage percentage
function getUsageColor(percent: number): string {
  if (percent >= 90) return 'bg-destructive';
  if (percent >= 80) return 'bg-warning';
  if (percent >= 70) return 'bg-amber-500';
  return 'bg-success';
}

// Circular progress component for resource gauges
function ResourceGauge({ 
  label, 
  value, 
  max, 
  unit, 
  icon: Icon 
}: { 
  label: string; 
  value: number; 
  max: number; 
  unit: string; 
  icon: React.ElementType;
}) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  const colorClass = getUsageColor(percent);
  
  return (
    <Card className="bg-muted/30 border-0">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <span className="text-xl font-bold">{percent}%</span>
          </div>
          <div className="text-right text-[10px] text-muted-foreground leading-tight">
            <div>{value.toFixed(1)} {unit}</div>
            <div>/ {max.toFixed(1)} {unit}</div>
          </div>
        </div>
        <Progress 
          value={percent} 
          className={`h-1.5 mt-2 ${colorClass}/20`}
        />
      </CardContent>
    </Card>
  );
}

// Feature card component for HA/DRS display
function FeatureCard({ 
  label, 
  enabled, 
  detail, 
  icon: Icon 
}: { 
  label: string; 
  enabled: boolean; 
  detail?: string;
  icon: React.ElementType;
}) {
  return (
    <div className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${enabled ? 'bg-success/10' : 'bg-muted/50'}`}>
      <div className={`p-1.5 rounded-md ${enabled ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <Badge variant={enabled ? "default" : "secondary"} className="text-[10px] h-4 px-1.5">
            {enabled ? "ON" : "OFF"}
          </Badge>
        </div>
        {detail && enabled && (
          <span className="text-xs text-muted-foreground">{detail}</span>
        )}
      </div>
    </div>
  );
}

// Quick stat card component
function QuickStat({ 
  label, 
  value, 
  icon: Icon,
  variant = 'default'
}: { 
  label: string; 
  value: string | number;
  icon: React.ElementType;
  variant?: 'default' | 'success' | 'warning';
}) {
  const bgClass = variant === 'success' ? 'bg-success/10' : variant === 'warning' ? 'bg-warning/10' : 'bg-muted/50';
  const iconClass = variant === 'success' ? 'text-success' : variant === 'warning' ? 'text-warning' : 'text-muted-foreground';
  
  return (
    <div className={`flex flex-col items-center p-2.5 rounded-lg ${bgClass}`}>
      <Icon className={`h-4 w-4 mb-1 ${iconClass}`} />
      <span className="text-lg font-bold">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
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
  onNavigateToHost,
  onSafetyCheck,
  onNavigateToHosts,
  onNavigateToVMs,
}: VCenterDetailsSidebarProps) {
  
  // VM Details View - Use dedicated component
  if (selectedVm) {
    return (
      <VMDetailsSidebar
        vm={selectedVm}
        onClose={onClose}
        onNavigateToHost={onNavigateToHost}
        onNavigateToDatastore={onNavigateToDatastore}
      />
    );
  }

  // Cluster Data Details View - REDESIGNED
  if (selectedClusterData) {
    // Calculate resource usage
    const cpuUsed = selectedClusterData.total_cpu_mhz ? (selectedClusterData.total_cpu_mhz - (selectedClusterData.effective_cpu_mhz || 0)) : 0;
    const cpuTotal = selectedClusterData.total_cpu_mhz || 0;
    const memUsedBytes = selectedClusterData.total_memory_bytes ? (selectedClusterData.total_memory_bytes - (selectedClusterData.effective_memory_bytes || 0)) : 0;
    const memTotalBytes = selectedClusterData.total_memory_bytes || 0;
    
    // Convert to GB for display
    const memUsedGB = memUsedBytes / (1024 ** 3);
    const memTotalGB = memTotalBytes / (1024 ** 3);
    const cpuUsedGHz = cpuUsed / 1000;
    const cpuTotalGHz = cpuTotal / 1000;
    
    // Calculate storage from datastores
    const totalStorageBytes = clusterDatastores?.reduce((sum, ds) => sum + (ds.capacity_bytes || 0), 0) || 0;
    const usedStorageBytes = clusterDatastores?.reduce((sum, ds) => sum + ((ds.capacity_bytes || 0) - (ds.free_bytes || 0)), 0) || 0;
    const storageTotalTB = totalStorageBytes / (1024 ** 4);
    const storageUsedTB = usedStorageBytes / (1024 ** 4);

    return (
      <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
        {/* Status bar */}
        <div className={`h-1 ${getStatusColor(selectedClusterData.overall_status)}`} />
        
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Cluster Details</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Cluster Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold truncate">{selectedClusterData.cluster_name}</h3>
                <p className="text-sm text-muted-foreground">{selectedClusterData.vcenter_name || "vCenter"}</p>
              </div>
              <Badge 
                variant={selectedClusterData.overall_status === 'green' ? 'default' : 'secondary'}
                className={selectedClusterData.overall_status === 'green' ? 'bg-success hover:bg-success' : selectedClusterData.overall_status === 'yellow' ? 'bg-warning hover:bg-warning text-warning-foreground' : ''}
              >
                {selectedClusterData.overall_status === 'green' ? 'Healthy' : selectedClusterData.overall_status || 'Unknown'}
              </Badge>
            </div>

            {/* Quick Stats Row */}
            <div className="grid grid-cols-3 gap-2">
              <QuickStat 
                label="Hosts" 
                value={selectedClusterData.host_count || 0} 
                icon={Server}
                variant="default"
              />
              <QuickStat 
                label="VMs" 
                value={selectedClusterData.vm_count || 0} 
                icon={MonitorDot}
                variant="default"
              />
              <QuickStat 
                label="Datastores" 
                value={clusterDatastores?.length || 0} 
                icon={HardDrive}
                variant="default"
              />
            </div>

            <Separator />

            {/* Resource Utilization */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Resource Utilization</h4>
              <div className="grid grid-cols-2 gap-2">
                <ResourceGauge 
                  label="CPU" 
                  value={cpuUsedGHz} 
                  max={cpuTotalGHz} 
                  unit="GHz" 
                  icon={Cpu} 
                />
                <ResourceGauge 
                  label="Memory" 
                  value={memUsedGB} 
                  max={memTotalGB} 
                  unit="GB" 
                  icon={MemoryStick} 
                />
              </div>
              {storageTotalTB > 0 && (
                <div className="mt-2">
                  <ResourceGauge 
                    label="Storage" 
                    value={storageUsedTB} 
                    max={storageTotalTB} 
                    unit="TB" 
                    icon={HardDrive} 
                  />
                </div>
              )}
            </div>

            <Separator />

            {/* Cluster Features */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Cluster Features</h4>
              <div className="space-y-2">
                <FeatureCard 
                  label="High Availability" 
                  enabled={selectedClusterData.ha_enabled} 
                  icon={Shield}
                />
                <FeatureCard 
                  label="DRS" 
                  enabled={selectedClusterData.drs_enabled}
                  detail={selectedClusterData.drs_automation_level}
                  icon={Shuffle}
                />
              </div>
            </div>

            <Separator />

            {/* Actions */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Actions</h4>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="default"
                  size="sm"
                  className="w-full"
                  onClick={() => onClusterUpdate(selectedClusterData.cluster_name)}
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Cluster Update
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onSafetyCheck?.(selectedClusterData.cluster_name)}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Safety Check
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => onNavigateToHosts?.(selectedClusterData.cluster_name)}
                >
                  <Server className="mr-2 h-4 w-4" />
                  View Hosts
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => onNavigateToVMs?.(selectedClusterData.cluster_name)}
                >
                  <MonitorDot className="mr-2 h-4 w-4" />
                  View VMs
                </Button>
              </div>
            </div>

            <Separator />

            {/* Datastores List */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Datastores
                </h4>
                {clusterDatastores && clusterDatastores.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {clusterDatastores.length} total
                  </Badge>
                )}
              </div>

              {clusterDatastoresLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : clusterDatastores && clusterDatastores.length > 0 ? (
                <div className="space-y-1.5">
                  {/* Aggregate stats */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2 px-1">
                    <span>Total: {formatBytes(totalStorageBytes)}</span>
                    <span>Avg Usage: {storageTotalTB > 0 ? Math.round((storageUsedTB / storageTotalTB) * 100) : 0}%</span>
                  </div>
                  
                  {clusterDatastores.map((ds) => {
                    const usagePercent = ds.capacity_bytes && ds.free_bytes
                      ? Math.round(((ds.capacity_bytes - ds.free_bytes) / ds.capacity_bytes) * 100)
                      : 0;
                    const isHighUsage = usagePercent >= 80;
                    
                    return (
                      <button
                        key={ds.id}
                        onClick={() => onNavigateToDatastore?.(ds.id)}
                        className={`w-full flex flex-col gap-1.5 p-2.5 rounded-lg transition-colors text-left ${isHighUsage ? 'bg-warning/10 hover:bg-warning/20' : 'bg-muted/30 hover:bg-muted/50'}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <HardDrive className={`h-3.5 w-3.5 flex-shrink-0 ${isHighUsage ? 'text-warning' : 'text-muted-foreground'}`} />
                          <span className="text-sm truncate flex-1 font-medium">{ds.name}</span>
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
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] h-4 px-1">
                            {ds.type || "Unknown"}
                          </Badge>
                          <div className="flex-1 flex items-center gap-1.5">
                            <Progress 
                              value={usagePercent} 
                              className={`h-1.5 flex-1 ${getUsageColor(usagePercent)}/20`}
                            />
                            <span className={`text-[10px] w-8 ${isHighUsage ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
                              {usagePercent}%
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No datastores accessible by this cluster</p>
              )}

              {clusterDatastores && clusterDatastores.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-3 flex items-center justify-center gap-4">
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
        {/* Status bar */}
        <div className={`h-1 ${selectedDatastore.accessible ? 'bg-success' : 'bg-destructive'}`} />
        
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Datastore Details</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold truncate">{selectedDatastore.name}</h3>
                <p className="text-sm text-muted-foreground">{selectedDatastore.type || "Unknown"} Datastore</p>
              </div>
              <Badge variant={selectedDatastore.accessible ? "default" : "destructive"}>
                {selectedDatastore.accessible ? "Accessible" : "Inaccessible"}
              </Badge>
            </div>

            {/* Capacity Gauge */}
            <Card className="bg-muted/30 border-0">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">Storage Usage</span>
                  <span className={`text-2xl font-bold ${usagePercent >= 80 ? 'text-warning' : usagePercent >= 90 ? 'text-destructive' : ''}`}>
                    {usagePercent}%
                  </span>
                </div>
                <Progress 
                  value={usagePercent} 
                  className={`h-3 ${getUsageColor(usagePercent)}/20`}
                />
                <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                  <span>Used: {formatBytes((selectedDatastore.capacity_bytes || 0) - (selectedDatastore.free_bytes || 0))}</span>
                  <span>Free: {formatBytes(selectedDatastore.free_bytes)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-2">
              <QuickStat 
                label="Total Capacity" 
                value={selectedDatastore.capacity_bytes 
                  ? `${(selectedDatastore.capacity_bytes / (1024 ** 4)).toFixed(2)}T`
                  : "0T"} 
                icon={Database}
              />
              <QuickStat 
                label="Hosts" 
                value={selectedDatastore.host_count || 0} 
                icon={Server}
              />
            </div>

            <Separator />

            {/* VMs on Datastore */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Virtual Machines
                </h4>
                <Badge variant="outline" className="text-[10px]">
                  {datastoreVMs?.length || selectedDatastore.vm_count || 0} VMs
                </Badge>
              </div>

              {datastoreVMsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : datastoreVMs && datastoreVMs.length > 0 ? (
                <div className="space-y-1.5">
                  {datastoreVMs.map((vm) => (
                    <button
                      key={vm.id}
                      onClick={() => onNavigateToVM?.(vm.id)}
                      className="w-full flex items-center justify-between p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${
                            vm.power_state === "poweredOn"
                              ? "bg-success"
                              : vm.power_state === "poweredOff"
                              ? "bg-destructive"
                              : "bg-warning"
                          }`}
                        />
                        <span className="text-sm truncate">{vm.name}</span>
                        {vm.is_primary_datastore && (
                          <Star className="h-3 w-3 text-warning flex-shrink-0" />
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                        {formatBytes(vm.committed_bytes)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No VMs on this datastore</p>
              )}

              {datastoreVMs && datastoreVMs.some((vm) => vm.is_primary_datastore) && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center justify-center gap-1">
                  <Star className="h-3 w-3 text-warning" /> Primary datastore
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
        {/* Status bar */}
        <div className={`h-1 ${selectedHost.status === 'connected' ? 'bg-success' : selectedHost.maintenance_mode ? 'bg-warning' : 'bg-destructive'}`} />
        
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Host Details</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold truncate">{selectedHost.name}</h3>
                <p className="text-sm text-muted-foreground">{selectedHost.cluster || "Unclustered"}</p>
              </div>
              <Badge 
                variant={selectedHost.status === "connected" ? "default" : "destructive"} 
                className={selectedHost.status === 'connected' ? 'bg-success hover:bg-success' : selectedHost.maintenance_mode ? 'bg-warning hover:bg-warning text-warning-foreground' : ''}
              >
                {selectedHost.maintenance_mode ? "Maintenance" : selectedHost.status || "Unknown"}
              </Badge>
            </div>

            {/* Quick Info */}
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                <span className="text-sm text-muted-foreground">ESXi Version</span>
                <Badge variant="outline" className="text-xs">
                  {selectedHost.esxi_version || "Unknown"}
                </Badge>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                <span className="text-sm text-muted-foreground">Serial Number</span>
                <span className="text-sm font-mono">{selectedHost.serial_number || "N/A"}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                <span className="text-sm text-muted-foreground">Last Sync</span>
                <span className="text-sm">
                  {selectedHost.last_sync ? formatDistanceToNow(new Date(selectedHost.last_sync), { addSuffix: true }) : "Never"}
                </span>
              </div>
            </div>

            <Separator />

            {/* Physical Server Link */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Physical Server</h4>
              {selectedHost.server_id ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-success/10">
                    <Link2 className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium text-success">Linked to physical server</span>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={() => onViewLinkedServer?.(selectedHost)}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View Physical Server
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30">
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Not linked to a physical server</span>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={() => onLinkToServer?.(selectedHost)}
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    Link to Server
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            {/* Actions */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Actions</h4>
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

  // Cluster Summary View (from Hosts tab grouping)
  if (selectedCluster) {
    const linkedHosts = selectedCluster.hosts.filter((h) => h.server_id).length;
    const connectedHosts = selectedCluster.hosts.filter((h) => h.status === "connected").length;

    return (
      <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
        {/* Status bar */}
        <div className={`h-1 ${connectedHosts === selectedCluster.hosts.length ? 'bg-success' : connectedHosts > 0 ? 'bg-warning' : 'bg-destructive'}`} />
        
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Cluster Summary</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Header */}
            <div>
              <h3 className="text-lg font-semibold">{selectedCluster.name}</h3>
              <p className="text-sm text-muted-foreground">Host cluster grouping</p>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-2">
              <QuickStat 
                label="Total Hosts" 
                value={selectedCluster.hosts.length} 
                icon={Server}
              />
              <QuickStat 
                label="Connected" 
                value={connectedHosts} 
                icon={Activity}
                variant={connectedHosts === selectedCluster.hosts.length ? 'success' : 'warning'}
              />
              <QuickStat 
                label="Linked" 
                value={linkedHosts} 
                icon={Link2}
                variant={linkedHosts > 0 ? 'success' : 'default'}
              />
            </div>

            <Separator />

            {/* Actions */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Actions</h4>
              <Button
                variant="default"
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
          <div className="rounded-full bg-muted p-4 mb-4">
            <Eye className="h-6 w-6 text-muted-foreground" />
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
