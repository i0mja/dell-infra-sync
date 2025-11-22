import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Activity,
  Users,
  Power,
  RefreshCw,
  Stethoscope,
  FileText,
  ClipboardList,
  Info,
  KeyRound,
  Link2,
  HeartPulse,
} from "lucide-react";
import { ReactNode, useState } from "react";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { formatDistanceToNow } from "date-fns";

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
  service_tag: string | null;
  idrac_firmware: string | null;
  connection_status: 'online' | 'offline' | 'unknown' | null;
  connection_error: string | null;
  credential_test_status: string | null;
  last_connection_test: string | null;
  vcenter_host_id: string | null;
  power_state?: string | null;
  overall_health?: string | null;
  last_health_check?: string | null;
  last_health_status?: string | null;
}

interface GroupData {
  name: string;
  group?: { id: string; name: string; color: string; icon?: string };
  cluster?: string;
  servers: Server[];
  onlineCount: number;
  linkedCount: number;
}

interface ServersTableProps {
  servers: Server[];
  groupedData: GroupData[] | null;
  selectedServerId: string | null;
  selectedGroupId: string | null;
  onServerClick: (server: Server) => void;
  onGroupClick: (groupId: string) => void;
  onServerRefresh: (server: Server) => void;
  onServerTest: (server: Server) => void;
  onServerHealth: (server: Server) => void;
  onServerPower: (server: Server) => void;
  onServerDetails: (server: Server) => void;
  onServerHealthDetails: (server: Server) => void;
  onServerEventLog: (server: Server) => void;
  onServerAudit: (server: Server) => void;
  onServerProperties: (server: Server) => void;
  onServerAssignCredentials: (server: Server) => void;
  onServerLinkVCenter: (server: Server) => void;
  loading: boolean;
  refreshing: string | null;
  healthCheckServer: string | null;
  hasActiveHealthCheck: (id: string) => boolean;
  isIncomplete: (server: Server) => boolean;
  groupMemberships?: any[];
  vCenterHosts?: any[];
}

export function ServersTable({
  servers,
  groupedData,
  selectedServerId,
  selectedGroupId,
  onServerClick,
  onGroupClick,
  onServerRefresh,
  onServerTest,
  onServerHealth,
  onServerPower,
  onServerDetails,
  onServerHealthDetails,
  onServerEventLog,
  onServerAudit,
  onServerProperties,
  onServerAssignCredentials,
  onServerLinkVCenter,
  loading,
  refreshing,
  healthCheckServer,
  hasActiveHealthCheck,
  isIncomplete,
  groupMemberships = [],
  vCenterHosts = [],
}: ServersTableProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (groupId: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupId)) {
      newCollapsed.delete(groupId);
    } else {
      newCollapsed.add(groupId);
    }
    setCollapsedGroups(newCollapsed);
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'online':
        return <Badge variant="default" className="gap-1"><span className="text-green-400">●</span> Online</Badge>;
      case 'offline':
        return <Badge variant="destructive" className="gap-1"><span>●</span> Offline</Badge>;
      default:
        return <Badge variant="secondary" className="gap-1"><span className="text-yellow-400">●</span> Unknown</Badge>;
    }
  };

  const getHealthBadge = (health?: string | null) => {
    if (!health) return <Badge variant="secondary">Unknown</Badge>;

    const variant = health === 'OK' ? 'default' : health === 'Warning' ? 'outline' : 'destructive';
    return <Badge variant={variant}>{health}</Badge>;
  };

  const getVCenterLink = (serverId: string) => {
    const host = vCenterHosts?.find(h => h.server_id === serverId);
    return host ? { linked: true, cluster: host.cluster } : { linked: false, cluster: null };
  };

  const getServerGroups = (serverId: string) => {
    return groupMemberships
      ?.filter(m => m.server_id === serverId)
      .map(m => m.server_groups as any) || [];
  };

  const renderServerContextMenu = (server: Server, row: ReactNode) => {
    const lastHealthRun = server.last_health_check
      ? formatDistanceToNow(new Date(server.last_health_check), { addSuffix: true })
      : 'Never run';

    const healthState = server.overall_health || server.last_health_status;

    return (
      <ContextMenu key={server.id}>
        <ContextMenuTrigger asChild>
          {row}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuLabel className="space-y-1">
            <div className="text-xs uppercase text-muted-foreground">Health</div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HeartPulse className="h-4 w-4 text-muted-foreground" />
                {getHealthBadge(healthState)}
              </div>
              <span className="text-xs text-muted-foreground">{lastHealthRun}</span>
            </div>
          </ContextMenuLabel>
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerHealthDetails(server);
            }}
          >
            <Activity className="h-4 w-4 mr-2" />
            Open health details
          </ContextMenuItem>
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerHealth(server);
            }}
          >
            <Stethoscope className="h-4 w-4 mr-2" />
            Run new health check
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerRefresh(server);
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh inventory
          </ContextMenuItem>
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerTest(server);
            }}
          >
            <ConnectionStatusBadge status={server.connection_status} />
            <span className="ml-2">Test credentials</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerAssignCredentials(server);
            }}
          >
            <KeyRound className="h-4 w-4 mr-2" />
            Assign credentials
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerEventLog(server);
            }}
          >
            <FileText className="h-4 w-4 mr-2" />
            View event log
          </ContextMenuItem>
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerAudit(server);
            }}
          >
            <ClipboardList className="h-4 w-4 mr-2" />
            View audit trail
          </ContextMenuItem>
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerProperties(server);
            }}
          >
            <Info className="h-4 w-4 mr-2" />
            View properties
          </ContextMenuItem>
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerDetails(server);
            }}
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            View details panel
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerPower(server);
            }}
          >
            <Power className="h-4 w-4 mr-2" />
            Power controls
          </ContextMenuItem>
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onServerLinkVCenter(server);
            }}
          >
            <Link2 className="h-4 w-4 mr-2" />
            Link to vCenter
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  if (loading) {
    return (
      <div className="border rounded-lg bg-card">
        <div className="p-4 space-y-3">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!groupedData) {
    // Flat view
    return (
      <div className="border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hostname / IP</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Service Tag</TableHead>
              <TableHead>iDRAC</TableHead>
              <TableHead>vCenter</TableHead>
              <TableHead>Groups</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {servers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No servers found
                </TableCell>
              </TableRow>
            ) : (
              servers.map((server) => {
                const vcLink = getVCenterLink(server.id);
                const serverGroups = getServerGroups(server.id);
                return renderServerContextMenu(server, (
                  <TableRow
                    className={`cursor-pointer ${selectedServerId === server.id ? 'bg-muted' : ''}`}
                    onClick={() => onServerClick(server)}
                  >
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{server.hostname || 'N/A'}</span>
                        <span className="text-xs text-muted-foreground">{server.ip_address}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(server.connection_status)}
                        {isIncomplete(server) && (
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                        )}
                        {(refreshing === server.id || hasActiveHealthCheck(server.id)) && (
                          <Activity className="h-4 w-4 animate-spin text-blue-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={!server.model ? 'text-muted-foreground' : ''}>
                        {server.model || 'N/A'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={!server.service_tag ? 'text-muted-foreground' : ''}>
                        {server.service_tag || 'N/A'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={!server.idrac_firmware ? 'text-muted-foreground' : ''}>
                        {server.idrac_firmware || 'N/A'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {vcLink.linked ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle className="h-3 w-3" />
                          {vcLink.cluster || 'Linked'}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not Linked</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {serverGroups.length > 0 ? (
                          serverGroups.slice(0, 2).map((group: any) => (
                            <Badge
                              key={group.id}
                              variant="outline"
                              style={{ borderColor: group.color }}
                              className="gap-1 text-xs"
                            >
                              <Users className="h-3 w-3" />
                              {group.name}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {serverGroups.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{serverGroups.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ));
              })
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  // Grouped view
  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hostname / IP</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Service Tag</TableHead>
            <TableHead>iDRAC</TableHead>
            <TableHead>vCenter</TableHead>
            <TableHead>Groups</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupedData.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                No servers found
              </TableCell>
            </TableRow>
          ) : (
            groupedData.map((groupData) => {
              const groupId = groupData.group?.id || groupData.cluster || 'ungrouped';
              const isCollapsed = collapsedGroups.has(groupId);

              return (
                <>
                  {/* Group Header Row */}
                  <TableRow
                    key={`group-${groupId}`}
                    className={`bg-muted/50 hover:bg-muted cursor-pointer ${selectedGroupId === groupId ? 'bg-muted' : ''}`}
                    onClick={() => {
                      toggleGroup(groupId);
                      onGroupClick(groupId);
                    }}
                  >
                    <TableCell colSpan={7}>
                      <div className="flex items-center gap-2 font-semibold">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                        {groupData.group && (
                          <Users className="h-4 w-4" style={{ color: groupData.group.color }} />
                        )}
                        <span>{groupData.name}</span>
                        <span className="text-sm font-normal text-muted-foreground">
                          ({groupData.servers.length} servers, {groupData.onlineCount} online, {groupData.linkedCount} linked)
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Server Rows */}
                  {!isCollapsed && groupData.servers.map((server) => {
                    const vcLink = getVCenterLink(server.id);
                    const serverGroups = getServerGroups(server.id);
                    return renderServerContextMenu(server, (
                      <TableRow
                        className={`cursor-pointer ${selectedServerId === server.id ? 'bg-muted' : ''}`}
                        onClick={() => onServerClick(server)}
                      >
                        <TableCell className="pl-12">
                          <div className="flex flex-col">
                            <span className="font-medium">{server.hostname || 'N/A'}</span>
                            <span className="text-xs text-muted-foreground">{server.ip_address}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusBadge(server.connection_status)}
                            {isIncomplete(server) && (
                              <AlertCircle className="h-4 w-4 text-orange-500" />
                            )}
                            {(refreshing === server.id || hasActiveHealthCheck(server.id)) && (
                              <Activity className="h-4 w-4 animate-spin text-blue-500" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={!server.model ? 'text-muted-foreground' : ''}>
                            {server.model || 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={!server.service_tag ? 'text-muted-foreground' : ''}>
                            {server.service_tag || 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={!server.idrac_firmware ? 'text-muted-foreground' : ''}>
                            {server.idrac_firmware || 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {vcLink.linked ? (
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle className="h-3 w-3" />
                              {vcLink.cluster || 'Linked'}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not Linked</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {serverGroups.length > 0 ? (
                              serverGroups.slice(0, 2).map((group: any) => (
                                <Badge
                                  key={group.id}
                                  variant="outline"
                                  style={{ borderColor: group.color }}
                                  className="gap-1 text-xs"
                                >
                                  <Users className="h-3 w-3" />
                                  {group.name}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                            {serverGroups.length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{serverGroups.length - 2}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ));
                  })}
                </>
              );
            })
          )}
        </TableBody>
      </Table>

      <div className="px-4 py-3 border-t bg-muted/20 text-sm text-muted-foreground">
        Showing {servers.length} server{servers.length !== 1 ? 's' : ''}
        {groupedData && ` in ${groupedData.length} group${groupedData.length !== 1 ? 's' : ''}`}
      </div>
    </div>
  );
}
