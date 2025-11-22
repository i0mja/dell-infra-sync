import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X, RefreshCw, Settings2, Power, Activity, FileText, HardDrive,
  Disc, FileJson, Shield, Edit, Trash2, Link2, Wrench, Users,
  CheckCircle, Calendar, Zap, FolderCog, FileStack, AlertCircle, Plus
} from "lucide-react";
import { format } from "date-fns";

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
  service_tag: string | null;
  manufacturer: string | null;
  product_name: string | null;
  idrac_firmware: string | null;
  bios_version: string | null;
  redfish_version: string | null;
  cpu_count: number | null;
  memory_gb: number | null;
  manager_mac_address: string | null;
  connection_status: 'online' | 'offline' | 'unknown' | null;
  connection_error: string | null;
  credential_test_status: string | null;
  credential_last_tested: string | null;
  last_connection_test: string | null;
  power_state: string | null;
  overall_health: string | null;
  last_health_check: string | null;
  vcenter_host_id: string | null;
  credential_set_id: string | null;
  last_seen: string | null;
  created_at: string;
  notes: string | null;
}

interface GroupData {
  name: string;
  group?: { id: string; name: string; color: string };
  cluster?: string;
  servers: Server[];
  onlineCount: number;
  linkedCount: number;
}

interface ServerDetailsSidebarProps {
  selectedServer: Server | null;
  selectedGroup: GroupData | null;
  servers: Server[];
  groupMemberships?: any[];
  vCenterHosts?: any[];
  onClose: () => void;
  onEdit: (server: Server) => void;
  onDelete: (server: Server) => void;
  onTestConnection: (server: Server) => void;
  onRefreshInfo: (server: Server) => void;
  onHealthCheck: (server: Server) => void;
  onPowerControl: (server: Server) => void;
  onBiosConfig: (server: Server) => void;
  onBootConfig: (server: Server) => void;
  onVirtualMedia: (server: Server) => void;
  onScpBackup: (server: Server) => void;
  onViewAudit: (server: Server) => void;
  onViewProperties: (server: Server) => void;
  onViewHealth: (server: Server) => void;
  onViewEventLog: (server: Server) => void;
  onLinkVCenter: (server: Server) => void;
  onAssignCredentials: (server: Server) => void;
  onCreateJob: (server: Server) => void;
  onWorkflow: (server: Server) => void;
  onPreFlight: (server: Server) => void;
  onAddServer: () => void;
  onRunDiscovery: () => void;
  onImportCsv: () => void;
  onManageCredentials: () => void;
  onManageGroups: () => void;
  refreshing: string | null;
}

export function ServerDetailsSidebar({
  selectedServer,
  selectedGroup,
  servers,
  groupMemberships = [],
  vCenterHosts = [],
  onClose,
  onEdit,
  onDelete,
  onTestConnection,
  onRefreshInfo,
  onHealthCheck,
  onPowerControl,
  onBiosConfig,
  onBootConfig,
  onVirtualMedia,
  onScpBackup,
  onViewAudit,
  onViewProperties,
  onViewHealth,
  onViewEventLog,
  onLinkVCenter,
  onAssignCredentials,
  onCreateJob,
  onWorkflow,
  onPreFlight,
  onAddServer,
  onRunDiscovery,
  onImportCsv,
  onManageCredentials,
  onManageGroups,
  refreshing,
}: ServerDetailsSidebarProps) {
  const getVCenterHost = (serverId: string) => {
    return vCenterHosts?.find(h => h.server_id === serverId);
  };

  const getServerGroups = (serverId: string) => {
    return groupMemberships
      ?.filter(m => m.server_id === serverId)
      .map(m => m.server_groups as any) || [];
  };

  // Server Details View
  if (selectedServer) {
    const vcHost = getVCenterHost(selectedServer.id);
    const serverGroups = getServerGroups(selectedServer.id);

    return (
      <div className="h-full border rounded-lg bg-card flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Server Details</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            {/* Title & Status */}
            <div>
              <h4 className="text-lg font-semibold mb-2">{selectedServer.hostname || selectedServer.ip_address}</h4>
              <div className="flex flex-wrap gap-2">
                {selectedServer.connection_status === 'online' && (
                  <Badge variant="default" className="gap-1">
                    <span className="text-green-400">●</span> Online
                  </Badge>
                )}
                {selectedServer.connection_status === 'offline' && (
                  <Badge variant="destructive" className="gap-1">● Offline</Badge>
                )}
                {(!selectedServer.connection_status || selectedServer.connection_status === 'unknown') && (
                  <Badge variant="secondary" className="gap-1">
                    <span className="text-yellow-400">●</span> Unknown
                  </Badge>
                )}
                {selectedServer.last_seen && (
                  <Badge variant="outline" className="text-xs">
                    <Calendar className="h-3 w-3 mr-1" />
                    {format(new Date(selectedServer.last_seen), 'MMM d, HH:mm')}
                  </Badge>
                )}
              </div>
            </div>

            <Separator />

            {/* System Info */}
            <div>
              <h5 className="font-semibold mb-3 flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                System Information
              </h5>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Model:</span>
                  <span className="font-medium">{selectedServer.model || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Service Tag:</span>
                  <span className="font-medium">{selectedServer.service_tag || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Manufacturer:</span>
                  <span className="font-medium">{selectedServer.manufacturer || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Product:</span>
                  <span className="font-medium">{selectedServer.product_name || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">iDRAC:</span>
                  <span className="font-medium">{selectedServer.idrac_firmware || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">BIOS:</span>
                  <span className="font-medium">{selectedServer.bios_version || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Redfish:</span>
                  <span className="font-medium">{selectedServer.redfish_version || 'N/A'}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Hardware */}
            <div>
              <h5 className="font-semibold mb-3 flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Hardware
              </h5>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">CPUs:</span>
                  <span className="font-medium">{selectedServer.cpu_count || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Memory:</span>
                  <span className="font-medium">{selectedServer.memory_gb ? `${selectedServer.memory_gb} GB` : 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">MAC:</span>
                  <span className="font-medium text-xs">{selectedServer.manager_mac_address || 'N/A'}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Credentials */}
            <div>
              <h5 className="font-semibold mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Credentials
              </h5>
              <div className="space-y-3 text-sm">
                {selectedServer.credential_set_id ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Status:</span>
                      {selectedServer.credential_test_status === 'success' ? (
                        <Badge variant="default" className="gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Valid
                        </Badge>
                      ) : selectedServer.credential_test_status === 'failed' ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Failed
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Not Tested</Badge>
                      )}
                    </div>
                    {selectedServer.credential_last_tested && (
                      <div className="grid grid-cols-2 gap-2">
                        <span className="text-muted-foreground">Last Test:</span>
                        <span className="text-xs">{format(new Date(selectedServer.credential_last_tested), 'MMM d, HH:mm')}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-muted-foreground">No credentials assigned</div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onAssignCredentials(selectedServer)}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  {selectedServer.credential_set_id ? 'Change Credentials' : 'Assign Credentials'}
                </Button>
              </div>
            </div>

            <Separator />

            {/* vCenter Linking */}
            <div>
              <h5 className="font-semibold mb-3 flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                vCenter Linking
              </h5>
              <div className="space-y-3 text-sm">
                {vcHost ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge variant="default" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Linked
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <span className="text-muted-foreground">Host:</span>
                      <span className="font-medium">{vcHost.name}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <span className="text-muted-foreground">Cluster:</span>
                      <span className="font-medium">{vcHost.cluster || 'N/A'}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-muted-foreground">Not linked to vCenter</div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onLinkVCenter(selectedServer)}
                >
                  <Link2 className="h-4 w-4 mr-2" />
                  {vcHost ? 'Change Link' : 'Link to vCenter'}
                </Button>
              </div>
            </div>

            <Separator />

            {/* Groups */}
            <div>
              <h5 className="font-semibold mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Server Groups
              </h5>
              <div className="space-y-2">
                {serverGroups.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {serverGroups.map((group: any) => (
                      <Badge
                        key={group.id}
                        variant="outline"
                        style={{ borderColor: group.color }}
                      >
                        {group.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No groups assigned</div>
                )}
              </div>
            </div>

            <Separator />

            {/* Health & Power */}
            <div>
              <h5 className="font-semibold mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Health & Power
              </h5>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Power State:</span>
                  <span className="font-medium">{selectedServer.power_state || 'Unknown'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Health:</span>
                  <span className="font-medium">{selectedServer.overall_health || 'Unknown'}</span>
                </div>
                {selectedServer.last_health_check && (
                  <div className="grid grid-cols-2 gap-2">
                    <span className="text-muted-foreground">Last Check:</span>
                    <span className="text-xs">{format(new Date(selectedServer.last_health_check), 'MMM d, HH:mm')}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPowerControl(selectedServer)}
                  >
                    <Power className="h-4 w-4 mr-2" />
                    Power
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onHealthCheck(selectedServer)}
                  >
                    <Activity className="h-4 w-4 mr-2" />
                    Check
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onViewEventLog(selectedServer)}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Event Logs
                </Button>
              </div>
            </div>

            <Separator />

            {/* Server Operations */}
            <div>
              <h5 className="font-semibold mb-3 flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                Server Operations
              </h5>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRefreshInfo(selectedServer)}
                  disabled={refreshing === selectedServer.id}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshing === selectedServer.id ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onBiosConfig(selectedServer)}
                >
                  <Settings2 className="h-4 w-4 mr-2" />
                  BIOS
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onBootConfig(selectedServer)}
                >
                  <HardDrive className="h-4 w-4 mr-2" />
                  Boot
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onVirtualMedia(selectedServer)}
                >
                  <Disc className="h-4 w-4 mr-2" />
                  Media
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onScpBackup(selectedServer)}
                >
                  <FileJson className="h-4 w-4 mr-2" />
                  SCP
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onViewAudit(selectedServer)}
                >
                  <FileStack className="h-4 w-4 mr-2" />
                  Audit
                </Button>
              </div>
            </div>

            <Separator />

            {/* Quick Actions */}
            <div>
              <h5 className="font-semibold mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Quick Actions
              </h5>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onCreateJob(selectedServer)}
                >
                  <FolderCog className="h-4 w-4 mr-2" />
                  Create Firmware Job
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onPreFlight(selectedServer)}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Pre-Flight Check
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onWorkflow(selectedServer)}
                >
                  <Activity className="h-4 w-4 mr-2" />
                  Start Workflow
                </Button>
              </div>
            </div>

            <Separator />

            {/* Management */}
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => onEdit(selectedServer)}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit Server
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive hover:text-destructive"
                onClick={() => onDelete(selectedServer)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Server
              </Button>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Group Details View
  if (selectedGroup) {
    const incompleteCount = selectedGroup.servers.filter(s => !s.model || !s.service_tag).length;
    const modelCounts = selectedGroup.servers.reduce((acc, server) => {
      const model = server.model || 'Unknown';
      acc[model] = (acc[model] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const firmwareCounts = selectedGroup.servers.reduce((acc, server) => {
      const fw = server.idrac_firmware || 'Unknown';
      acc[fw] = (acc[fw] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return (
      <div className="h-full border rounded-lg bg-card flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Group Details</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            {/* Title */}
            <div>
              <h4 className="text-lg font-semibold mb-2">{selectedGroup.name}</h4>
              <p className="text-sm text-muted-foreground">{selectedGroup.servers.length} Dell Servers</p>
            </div>

            <Separator />

            {/* Summary */}
            <div>
              <h5 className="font-semibold mb-3">Summary</h5>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Total Servers:</span>
                  <span className="font-medium">{selectedGroup.servers.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Online:</span>
                  <span className="font-medium">{selectedGroup.onlineCount} ({Math.round(selectedGroup.onlineCount / selectedGroup.servers.length * 100)}%)</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Linked to vCenter:</span>
                  <span className="font-medium">{selectedGroup.linkedCount} ({Math.round(selectedGroup.linkedCount / selectedGroup.servers.length * 100)}%)</span>
                </div>
                {incompleteCount > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <span className="text-muted-foreground">Incomplete Data:</span>
                    <span className="font-medium text-orange-500">{incompleteCount}</span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Models */}
            <div>
              <h5 className="font-semibold mb-3">Model Distribution</h5>
              <div className="space-y-2 text-sm">
                {Object.entries(modelCounts).map(([model, count]) => (
                  <div key={model} className="grid grid-cols-2 gap-2">
                    <span className="text-muted-foreground">• {model}:</span>
                    <span className="font-medium">{count} server{count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Firmware Versions */}
            <div>
              <h5 className="font-semibold mb-3">iDRAC Firmware</h5>
              <div className="space-y-2 text-sm">
                {Object.entries(firmwareCounts).map(([fw, count]) => (
                  <div key={fw} className="grid grid-cols-2 gap-2">
                    <span className="text-muted-foreground">• {fw}:</span>
                    <span className="font-medium">{count} server{count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Bulk Operations */}
            <div>
              <h5 className="font-semibold mb-3">Bulk Operations</h5>
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh All ({selectedGroup.servers.length})
                </Button>
                <Button variant="outline" size="sm" className="w-full">
                  <Shield className="h-4 w-4 mr-2" />
                  Test All Connections
                </Button>
                <Button variant="outline" size="sm" className="w-full">
                  <FolderCog className="h-4 w-4 mr-2" />
                  Create Group Job
                </Button>
                <Button variant="outline" size="sm" className="w-full">
                  <Activity className="h-4 w-4 mr-2" />
                  Rolling Update
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Quick Actions View (Nothing Selected)
  return (
    <div className="h-full border rounded-lg bg-card flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-semibold">Server Inventory</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="text-sm text-muted-foreground">
            Select a server or group to view details
          </div>

          <Separator />

          <div>
            <h5 className="font-semibold mb-3">Quick Actions</h5>
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={onAddServer}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Server
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={onRunDiscovery}
              >
                <Wrench className="h-4 w-4 mr-2" />
                Run Discovery Scan
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={onImportCsv}
              >
                <FileText className="h-4 w-4 mr-2" />
                Import from CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={onManageCredentials}
              >
                <Shield className="h-4 w-4 mr-2" />
                Manage Credentials
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={onManageGroups}
              >
                <Users className="h-4 w-4 mr-2" />
                Manage Server Groups
              </Button>
            </div>
          </div>

          <Separator />

          <div>
            <h5 className="font-semibold mb-3">Statistics</h5>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">Total Servers:</span>
                <span className="font-medium">{servers.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">Online:</span>
                <span className="font-medium">{servers.filter(s => s.connection_status === 'online').length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">Offline:</span>
                <span className="font-medium">{servers.filter(s => s.connection_status === 'offline').length}</span>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
