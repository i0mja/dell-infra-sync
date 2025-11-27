import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  X,
  Server as ServerIcon,
  RefreshCw,
  Activity,
  Power,
  Settings,
  Wrench,
  Eye,
  FileText,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Server } from "@/hooks/useServers";

interface GroupData {
  name: string;
  servers: Server[];
}

interface ServerDetailsSidebarProps {
  selectedServer: Server | null;
  selectedGroup: GroupData | null;
  refreshing: boolean;
  testing: boolean;
  onClose: () => void;
  onEdit: (server: Server) => void;
  onDelete: (server: Server) => void;
  onTestConnection: (server: Server) => void;
  onRefreshInfo: (server: Server) => void;
  onPowerControl: (server: Server) => void;
  onBiosConfig: (server: Server) => void;
  onViewHealth: (server: Server) => void;
  onViewAudit: (server: Server) => void;
  onCreateJob: (server: Server) => void;
}

export function ServerDetailsSidebar({
  selectedServer,
  selectedGroup,
  refreshing,
  testing,
  onClose,
  onEdit,
  onDelete,
  onTestConnection,
  onRefreshInfo,
  onPowerControl,
  onBiosConfig,
  onViewHealth,
  onViewAudit,
  onCreateJob,
}: ServerDetailsSidebarProps) {
  // Server Details View
  if (selectedServer) {
    const statusColors = {
      online: "bg-success text-success-foreground",
      offline: "bg-destructive text-destructive-foreground",
      unknown: "bg-muted text-muted-foreground",
    };

    const healthColors = {
      OK: "text-success",
      Warning: "text-warning",
      Critical: "text-destructive",
    };

    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg truncate">
                {selectedServer.hostname || selectedServer.ip_address}
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                {selectedServer.model || "Unknown Model"}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge
              className={
                statusColors[selectedServer.connection_status || "unknown"]
              }
            >
              {selectedServer.connection_status || "Unknown"}
            </Badge>
            {selectedServer.overall_health && (
              <Badge variant="outline">
                <span
                  className={
                    healthColors[
                      selectedServer.overall_health as keyof typeof healthColors
                    ] || "text-muted-foreground"
                  }
                >
                  {selectedServer.overall_health}
                </span>
              </Badge>
            )}
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="flex-1 overflow-auto pt-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-3">System Information</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">IP Address:</span>
                <span className="font-mono text-xs">{selectedServer.ip_address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Service Tag:</span>
                <span className="font-mono text-xs">
                  {selectedServer.service_tag || "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">iDRAC Firmware:</span>
                <span className="text-xs">{selectedServer.idrac_firmware || "N/A"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">BIOS Version:</span>
                <span className="text-xs">{selectedServer.bios_version || "N/A"}</span>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="text-sm font-semibold mb-3">Hardware</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">CPUs:</span>
                <span className="font-medium">{selectedServer.cpu_count || "N/A"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Memory:</span>
                <span className="font-medium">
                  {selectedServer.memory_gb ? `${selectedServer.memory_gb} GB` : "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Power State:</span>
                <span className="font-medium capitalize">
                  {selectedServer.power_state || "Unknown"}
                </span>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="text-sm font-semibold mb-3">Connectivity</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Credentials:</span>
                <Badge variant={selectedServer.credential_set_id ? "secondary" : "outline"}>
                  {selectedServer.credential_set_id ? "Assigned" : "None"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Seen:</span>
                <span className="text-xs">
                  {selectedServer.last_seen
                    ? formatDistanceToNow(new Date(selectedServer.last_seen), {
                        addSuffix: true,
                      })
                    : "Never"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>

        <Separator />

        <div className="p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTestConnection(selectedServer)}
              disabled={testing}
            >
              {testing ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Activity className="mr-2 h-3 w-3" />
              )}
              Test
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRefreshInfo(selectedServer)}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3 w-3" />
              )}
              Refresh
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onPowerControl(selectedServer)}
          >
            <Power className="mr-2 h-3 w-3" />
            Power Controls
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onBiosConfig(selectedServer)}
          >
            <Settings className="mr-2 h-3 w-3" />
            BIOS Config
          </Button>

          <Separator className="my-2" />

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewHealth(selectedServer)}
            >
              <Eye className="mr-2 h-3 w-3" />
              Health
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewAudit(selectedServer)}
            >
              <FileText className="mr-2 h-3 w-3" />
              Audit
            </Button>
          </div>

          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={() => onCreateJob(selectedServer)}
          >
            <Wrench className="mr-2 h-3 w-3" />
            Create Job
          </Button>

          <Separator className="my-2" />

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(selectedServer)}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => onDelete(selectedServer)}
            >
              Delete
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // Group Details View
  if (selectedGroup) {
    const onlineCount = selectedGroup.servers.filter(
      (s) => s.connection_status === "online"
    ).length;
    const offlineCount = selectedGroup.servers.filter(
      (s) => s.connection_status === "offline"
    ).length;

    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">{selectedGroup.name}</CardTitle>
              <CardDescription className="text-xs mt-1">
                {selectedGroup.servers.length} Servers
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="flex-1 overflow-auto pt-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-3">Group Summary</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Servers:</span>
                <span className="font-medium">{selectedGroup.servers.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Online:</span>
                <span className="font-medium text-success">{onlineCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Offline:</span>
                <span className="font-medium text-warning">{offlineCount}</span>
              </div>
            </div>
          </div>
        </CardContent>

        <Separator />

        <div className="p-4 space-y-2">
          <Button variant="outline" size="sm" className="w-full">
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh All
          </Button>
          <Button variant="default" size="sm" className="w-full">
            <Wrench className="mr-2 h-3 w-3" />
            Bulk Operations
          </Button>
        </div>
      </Card>
    );
  }

  // Empty State
  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">Server Details</CardTitle>
        <CardDescription>Select a server or group to view details</CardDescription>
      </CardHeader>

      <Separator />

      <CardContent className="flex-1 overflow-auto pt-4 space-y-4">
        <div className="text-center text-muted-foreground text-sm py-8">
          <ServerIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No server selected</p>
          <p className="text-xs mt-1">Click on a server row to view details</p>
        </div>
      </CardContent>
    </Card>
  );
}
