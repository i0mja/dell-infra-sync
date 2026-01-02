import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  X, HardDrive, Server, MonitorDot, Cpu, MemoryStick,
  Network, Settings2, FileText, ChevronDown, ChevronRight,
  Clock, Star, Wifi, WifiOff, ExternalLink, Camera, Tags,
  Folder, Layers, Box
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useVMHost } from "@/hooks/useVMHost";
import { useVMDatastores } from "@/hooks/useVMDatastores";
import { useVMNetworks } from "@/hooks/useVMNetworks";
import { useVMSnapshots, VMSnapshot } from "@/hooks/useVMSnapshots";
import { useVMCustomAttributes } from "@/hooks/useVMCustomAttributes";
import { useState } from "react";
import { SidebarBreadcrumb, SidebarNavItem } from "./SidebarBreadcrumb";

interface VMDetailsSidebarProps {
  vm: any;
  onClose: () => void;
  onNavigateToHost?: (hostId: string) => void;
  onNavigateToDatastore?: (datastoreId: string) => void;
  onNavigateToCluster?: (clusterId: string) => void;
  // Breadcrumb navigation props
  navStack?: SidebarNavItem[];
  onNavigateBack?: () => void;
  onNavigateTo?: (index: number) => void;
}

interface SnapshotNode extends VMSnapshot {
  children: SnapshotNode[];
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getUsageColor(percent: number): string {
  if (percent >= 90) return 'bg-destructive';
  if (percent >= 80) return 'bg-warning';
  if (percent >= 70) return 'bg-amber-500';
  return 'bg-success';
}

function buildSnapshotTree(snapshots: VMSnapshot[]): SnapshotNode[] {
  const snapshotMap = new Map<string, SnapshotNode>();
  
  // Create nodes with empty children array
  snapshots.forEach(snap => {
    snapshotMap.set(snap.snapshot_id, { ...snap, children: [] });
  });
  
  const roots: SnapshotNode[] = [];
  
  // Build tree structure
  snapshots.forEach(snap => {
    const node = snapshotMap.get(snap.snapshot_id)!;
    if (snap.parent_snapshot_id && snapshotMap.has(snap.parent_snapshot_id)) {
      snapshotMap.get(snap.parent_snapshot_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  
  return roots;
}

function SnapshotItem({ 
  snapshot, 
  depth = 0 
}: { 
  snapshot: SnapshotNode; 
  depth?: number;
}) {
  const hasChildren = snapshot.children.length > 0;
  const indent = depth * 16;
  
  return (
    <div>
      <div 
        className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-muted/50"
        style={{ marginLeft: indent }}
      >
        <Camera className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{snapshot.name}</span>
            {snapshot.is_current && (
              <Badge variant="default" className="text-[10px] h-4 px-1.5 bg-primary">
                Current
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {snapshot.created_at && (
              <span>{format(new Date(snapshot.created_at), 'MMM d, yyyy HH:mm')}</span>
            )}
            {snapshot.size_bytes > 0 && (
              <>
                <span>•</span>
                <span>{formatBytes(snapshot.size_bytes)}</span>
              </>
            )}
          </div>
          {snapshot.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{snapshot.description}</p>
          )}
        </div>
      </div>
      {hasChildren && (
        <div className="border-l border-border/50 ml-4" style={{ marginLeft: indent + 8 }}>
          {snapshot.children.map(child => (
            <SnapshotItem key={child.id} snapshot={child} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

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

function SectionHeader({ 
  title, 
  icon: Icon, 
  isOpen, 
  onToggle,
  count
}: { 
  title: string; 
  icon: React.ElementType; 
  isOpen: boolean; 
  onToggle: () => void;
  count?: number;
}) {
  return (
    <CollapsibleTrigger 
      onClick={onToggle}
      className="flex items-center justify-between w-full py-2 hover:bg-muted/50 rounded-lg px-2 -mx-2 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        {count !== undefined && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            {count}
          </Badge>
        )}
      </div>
      {isOpen ? (
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      )}
    </CollapsibleTrigger>
  );
}

export function VMDetailsSidebar({
  vm,
  onClose,
  onNavigateToHost,
  onNavigateToDatastore,
  onNavigateToCluster,
  navStack = [],
  onNavigateBack,
  onNavigateTo,
}: VMDetailsSidebarProps) {
  const [openSections, setOpenSections] = useState({
    storage: true,
    networking: true,
    snapshots: true,
    customAttributes: false,
    notes: false,
    metadata: false,
  });

  const { data: host, isLoading: hostLoading } = useVMHost(vm?.host_id);
  const { data: datastores, isLoading: datastoresLoading } = useVMDatastores(vm?.id);
  const { data: networks, isLoading: networksLoading } = useVMNetworks(vm?.id);
  const { data: snapshots, isLoading: snapshotsLoading } = useVMSnapshots(vm?.id);
  const { data: customAttributes, isLoading: attributesLoading } = useVMCustomAttributes(vm?.id);

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const powerState = vm.power_state;
  const powerColor = powerState === 'poweredOn' ? 'bg-success' : powerState === 'poweredOff' ? 'bg-destructive' : 'bg-warning';
  
  // Build snapshot tree
  const snapshotTree = snapshots ? buildSnapshotTree(snapshots) : [];

  // Current nav item for breadcrumb
  const currentNavItem: SidebarNavItem = { type: 'vm', id: vm.id, name: vm.name };
  const showBreadcrumb = navStack.length > 0 && onNavigateBack && onNavigateTo;

  return (
    <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
      {/* Status bar */}
      <div className={`h-1 ${powerColor}`} />
      
      {/* Breadcrumb navigation */}
      {showBreadcrumb && (
        <SidebarBreadcrumb
          navStack={navStack}
          currentItem={currentNavItem}
          onNavigateBack={onNavigateBack}
          onNavigateTo={onNavigateTo}
        />
      )}
      
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <MonitorDot className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">VM Details</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Header with name and power state */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold truncate">{vm.name}</h3>
              <p className="text-sm text-muted-foreground">{vm.cluster_name || "No Cluster"}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge 
                variant={powerState === 'poweredOn' ? 'default' : 'secondary'}
                className={powerState === 'poweredOn' ? 'bg-success hover:bg-success' : ''}
              >
                {powerState === 'poweredOn' ? 'Running' : powerState === 'poweredOff' ? 'Stopped' : powerState || 'Unknown'}
              </Badge>
              {vm.is_template && (
                <Badge variant="outline" className="text-xs">Template</Badge>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-2">
            <QuickStat 
              label="vCPUs" 
              value={vm.cpu_count || 0} 
              icon={Cpu}
            />
            <QuickStat 
              label="Memory" 
              value={vm.memory_mb ? `${Math.round(vm.memory_mb / 1024)}G` : "0G"} 
              icon={MemoryStick}
            />
            <QuickStat 
              label="Disk" 
              value={vm.disk_gb ? `${vm.disk_gb.toFixed(0)}G` : "0G"} 
              icon={HardDrive}
            />
          </div>

          <Separator />

          {/* ESXi Host Section */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">ESXi Host</h4>
            {hostLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : host ? (
              <Card 
                className="bg-muted/30 border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => onNavigateToHost?.(host.id)}
              >
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{host.name}</span>
                      {host.esxi_version && (
                        <span className="text-xs text-muted-foreground">ESXi {host.esxi_version}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={host.status === 'connected' ? 'default' : 'secondary'}
                      className={`text-xs ${host.status === 'connected' ? 'bg-success hover:bg-success' : ''}`}
                    >
                      {host.status || 'Unknown'}
                    </Badge>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">No host information available</p>
            )}
          </div>

          <Separator />

          {/* VM Details */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Details</h4>
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">IP Address</span>
                <span className="text-sm font-mono">{vm.ip_address || "N/A"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Guest OS</span>
                <span className="text-sm truncate max-w-[200px]">{vm.guest_os || "Unknown"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Overall Status</span>
                <Badge 
                  variant={vm.overall_status === 'green' ? 'default' : 'secondary'}
                  className={`text-xs ${vm.overall_status === 'green' ? 'bg-success hover:bg-success' : vm.overall_status === 'yellow' ? 'bg-warning hover:bg-warning' : ''}`}
                >
                  {vm.overall_status || 'Unknown'}
                </Badge>
              </div>
              {vm.resource_pool && (
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <Box className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Resource Pool</span>
                  </div>
                  <span className="text-sm truncate max-w-[180px]">{vm.resource_pool}</span>
                </div>
              )}
              {vm.hardware_version && (
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Hardware Version</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {vm.hardware_version}
                  </Badge>
                </div>
              )}
              {vm.folder_path && (
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Folder</span>
                  </div>
                  <span className="text-sm truncate max-w-[180px] text-right" title={vm.folder_path}>
                    {vm.folder_path}
                  </span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* VMware Tools */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">VMware Tools</h4>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{vm.tools_status || "Unknown"}</span>
              </div>
              {vm.tools_version && (
                <Badge variant="outline" className="text-xs">
                  v{vm.tools_version}
                </Badge>
              )}
            </div>
          </div>

          <Separator />

          {/* Storage Section */}
          <Collapsible open={openSections.storage}>
            <SectionHeader 
              title="Storage" 
              icon={HardDrive} 
              isOpen={openSections.storage}
              onToggle={() => toggleSection('storage')}
              count={datastores?.length}
            />
            <CollapsibleContent className="space-y-2 mt-2">
              {datastoresLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : datastores && datastores.length > 0 ? (
                datastores.map((ds) => {
                  const usedBytes = ds.committed_bytes || 0;
                  const totalBytes = ds.capacity_bytes || 0;
                  const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
                  
                  return (
                    <Card 
                      key={ds.id}
                      className="bg-muted/30 border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => onNavigateToDatastore?.(ds.id)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <HardDrive className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm font-medium truncate">{ds.name}</span>
                            {ds.is_primary_datastore && (
                              <Star className="h-3 w-3 text-warning flex-shrink-0" />
                            )}
                          </div>
                          <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          <Progress 
                            value={usagePercent} 
                            className={`h-1.5 flex-1 ${getUsageColor(usagePercent)}/20`}
                          />
                          <span className="text-xs text-muted-foreground w-8 text-right">{usagePercent}%</span>
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Used: {formatBytes(usedBytes)}</span>
                          <span>Total: {formatBytes(totalBytes)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground py-2">No datastores found</p>
              )}
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* Networking Section */}
          <Collapsible open={openSections.networking}>
            <SectionHeader 
              title="Networking" 
              icon={Network} 
              isOpen={openSections.networking}
              onToggle={() => toggleSection('networking')}
              count={networks?.length}
            />
            <CollapsibleContent className="space-y-2 mt-2">
              {networksLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : networks && networks.length > 0 ? (
                networks.map((nic) => (
                  <Card key={nic.id} className="bg-muted/30 border-0">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {nic.connected ? (
                            <Wifi className="h-4 w-4 text-success" />
                          ) : (
                            <WifiOff className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="text-sm font-medium">{nic.nic_label || "Network Adapter"}</span>
                        </div>
                        <Badge variant={nic.connected ? "default" : "secondary"} className={`text-xs ${nic.connected ? 'bg-success hover:bg-success' : ''}`}>
                          {nic.connected ? "Connected" : "Disconnected"}
                        </Badge>
                      </div>
                      
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Network</span>
                          <span className="font-medium">{nic.network_name}</span>
                        </div>
                        
                        {nic.vlan_id !== null && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">VLAN ID</span>
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                              {nic.vlan_id}
                            </Badge>
                          </div>
                        )}
                        
                        {nic.mac_address && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">MAC</span>
                            <span className="font-mono text-[10px]">{nic.mac_address}</span>
                          </div>
                        )}
                        
                        {nic.adapter_type && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Adapter</span>
                            <span>{nic.adapter_type}</span>
                          </div>
                        )}
                        
                        {nic.ip_addresses && nic.ip_addresses.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border/50">
                            <span className="text-muted-foreground block mb-1">IP Addresses</span>
                            <div className="space-y-0.5">
                              {nic.ip_addresses.map((ip, idx) => (
                                <span key={idx} className="font-mono block">{ip}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-2">No network adapters found</p>
              )}
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* Snapshots Section */}
          <Collapsible open={openSections.snapshots}>
            <SectionHeader 
              title="Snapshots" 
              icon={Camera} 
              isOpen={openSections.snapshots}
              onToggle={() => toggleSection('snapshots')}
              count={snapshots?.length || vm.snapshot_count || 0}
            />
            <CollapsibleContent className="mt-2">
              {snapshotsLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : snapshotTree.length > 0 ? (
                <Card className="bg-muted/30 border-0">
                  <CardContent className="p-2">
                    {snapshotTree.map(snapshot => (
                      <SnapshotItem key={snapshot.id} snapshot={snapshot} />
                    ))}
                  </CardContent>
                </Card>
              ) : (
                <p className="text-sm text-muted-foreground py-2">No snapshots found</p>
              )}
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* Custom Attributes Section */}
          <Collapsible open={openSections.customAttributes}>
            <SectionHeader 
              title="Custom Attributes" 
              icon={Tags} 
              isOpen={openSections.customAttributes}
              onToggle={() => toggleSection('customAttributes')}
              count={customAttributes?.length}
            />
            <CollapsibleContent className="mt-2">
              {attributesLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : customAttributes && customAttributes.length > 0 ? (
                <Card className="bg-muted/30 border-0">
                  <CardContent className="p-3 space-y-2">
                    {customAttributes
                      .sort((a, b) => a.attribute_key.localeCompare(b.attribute_key))
                      .map((attr) => (
                        <div key={attr.id} className="flex justify-between items-start gap-2">
                          <span className="text-sm text-muted-foreground flex-shrink-0">
                            {attr.attribute_key}
                          </span>
                          <span 
                            className="text-sm text-right truncate max-w-[200px]" 
                            title={attr.attribute_value || ''}
                          >
                            {attr.attribute_value || '—'}
                          </span>
                        </div>
                      ))}
                  </CardContent>
                </Card>
              ) : (
                <p className="text-sm text-muted-foreground py-2">No custom attributes found</p>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Notes Section */}
          {vm.notes && (
            <>
              <Separator />
              <Collapsible open={openSections.notes}>
                <SectionHeader 
                  title="Notes" 
                  icon={FileText} 
                  isOpen={openSections.notes}
                  onToggle={() => toggleSection('notes')}
                />
                <CollapsibleContent className="mt-2">
                  <Card className="bg-muted/30 border-0">
                    <CardContent className="p-3">
                      <p className="text-sm whitespace-pre-wrap">{vm.notes}</p>
                    </CardContent>
                  </Card>
                </CollapsibleContent>
              </Collapsible>
            </>
          )}

          {/* Metadata Section */}
          <Separator />
          <Collapsible open={openSections.metadata}>
            <SectionHeader 
              title="Metadata" 
              icon={Clock} 
              isOpen={openSections.metadata}
              onToggle={() => toggleSection('metadata')}
            />
            <CollapsibleContent className="mt-2">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">vCenter ID</span>
                  <span className="font-mono text-xs truncate max-w-[180px]">{vm.vcenter_id || "N/A"}</span>
                </div>
                {vm.hardware_version && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Hardware Version</span>
                    <span className="text-xs">{vm.hardware_version}</span>
                  </div>
                )}
                {vm.folder_path && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Folder Path</span>
                    <span className="text-xs truncate max-w-[180px]" title={vm.folder_path}>{vm.folder_path}</span>
                  </div>
                )}
                {(vm.snapshot_count > 0 || (snapshots && snapshots.length > 0)) && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Snapshot Count</span>
                    <span className="text-xs">{snapshots?.length || vm.snapshot_count}</span>
                  </div>
                )}
                {vm.resource_pool && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Resource Pool</span>
                    <span className="text-xs truncate max-w-[180px]">{vm.resource_pool}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Last Synced</span>
                  <span className="text-xs">
                    {vm.last_sync 
                      ? formatDistanceToNow(new Date(vm.last_sync), { addSuffix: true })
                      : "Never"
                    }
                  </span>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  );
}
