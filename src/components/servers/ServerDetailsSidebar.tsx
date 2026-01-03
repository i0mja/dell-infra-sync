import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X,
  Server as ServerIcon,
  RefreshCw,
  Wrench,
} from "lucide-react";
import type { Server } from "@/hooks/useServers";
import { useServerDrives } from "@/hooks/useServerDrives";
import { useServerNics } from "@/hooks/useServerNics";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConsoleLauncher } from "@/hooks/useConsoleLauncher";
import {
  ServerQuickStats,
  ServerNicsSummary,
  ServerStorageSummary,
  ServerSystemInfo,
  ServerConnectivity,
  ServerActions,
} from "./sidebar";

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
  onBootConfig: (server: Server) => void;
  onVirtualMedia: (server: Server) => void;
  onScpBackup: (server: Server) => void;
  onViewEventLog: (server: Server) => void;
  onViewHealth: (server: Server) => void;
  onViewAudit: (server: Server) => void;
  onViewProperties: (server: Server) => void;
  onWorkflow: (server: Server) => void;
  onLinkVCenter: (server: Server) => void;
  onAssignCredentials: (server: Server) => void;
  onCreateJob: (server: Server) => void;
  onNetworkSettings: (server: Server) => void;
}

// Status bar color based on connection status
function getStatusBarColor(status: string | null): string {
  switch (status) {
    case "online":
      return "bg-success";
    case "offline":
      return "bg-destructive";
    default:
      return "bg-muted";
  }
}

// Health badge styling
function getHealthBadgeVariant(health: string | null): "default" | "secondary" | "destructive" | "outline" {
  switch (health) {
    case "OK":
      return "secondary";
    case "Warning":
      return "outline";
    case "Critical":
      return "destructive";
    default:
      return "outline";
  }
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
  onBootConfig,
  onVirtualMedia,
  onScpBackup,
  onViewEventLog,
  onViewHealth,
  onViewAudit,
  onViewProperties,
  onWorkflow,
  onLinkVCenter,
  onAssignCredentials,
  onCreateJob,
  onNetworkSettings,
}: ServerDetailsSidebarProps) {
  const { launching: launchingConsole, launchConsole } = useConsoleLauncher();

  // Fetch drives and NICs for selected server
  const { data: drives, isLoading: drivesLoading } = useServerDrives(selectedServer?.id || null);
  const { data: nics, isLoading: nicsLoading } = useServerNics(selectedServer?.id || null);

  const handleLaunchConsole = async () => {
    if (!selectedServer) return;
    await launchConsole(selectedServer.id, selectedServer.hostname || selectedServer.ip_address);
  };

  const handleAutoLinkVCenter = async () => {
    if (!selectedServer) return;
    
    // Try auto-link first
    if (selectedServer.service_tag) {
      const { data: vCenterHost } = await supabase
        .from("vcenter_hosts")
        .select("id, name, cluster")
        .eq("serial_number", selectedServer.service_tag)
        .is("server_id", null)
        .single();

      if (vCenterHost) {
        // Auto-link found a match
        await Promise.all([
          supabase
            .from("servers")
            .update({ vcenter_host_id: vCenterHost.id })
            .eq("id", selectedServer.id),
          supabase
            .from("vcenter_hosts")
            .update({ server_id: selectedServer.id })
            .eq("id", vCenterHost.id)
        ]);

        toast.success("Auto-linked to vCenter", {
          description: `Linked to ${vCenterHost.name}${vCenterHost.cluster ? ` (${vCenterHost.cluster})` : ""}`
        });
        return;
      }
    }
    // No auto-match, open manual dialog
    onLinkVCenter(selectedServer);
  };

  // Server Details View
  if (selectedServer) {
    const statusBadgeColors: Record<string, string> = {
      online: "bg-success text-success-foreground",
      offline: "bg-destructive text-destructive-foreground",
      unknown: "bg-muted text-muted-foreground",
    };

    return (
      <Card className="h-full flex flex-col overflow-hidden">
        {/* Status Bar */}
        <div className={`h-1.5 ${getStatusBarColor(selectedServer.connection_status)}`} />

        {/* Header */}
        <CardHeader className="pb-3 pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold truncate">
                {selectedServer.hostname || selectedServer.ip_address}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                <span className="font-mono">{selectedServer.ip_address}</span>
                <span>•</span>
                <span className="truncate">{selectedServer.model || "Unknown Model"}</span>
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 -mr-1" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Status Badges */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <Badge className={statusBadgeColors[selectedServer.connection_status || "unknown"]}>
              {selectedServer.connection_status || "Unknown"}
            </Badge>
            {selectedServer.overall_health && (
              <Badge variant={getHealthBadgeVariant(selectedServer.overall_health)}>
                {selectedServer.overall_health}
              </Badge>
            )}
            {selectedServer.power_state && (
              <Badge variant="outline" className="capitalize">
                {selectedServer.power_state}
              </Badge>
            )}
            {selectedServer.vcenter_host_id && (
              <Badge variant="secondary" className="text-[10px]">
                vCenter
              </Badge>
            )}
          </div>
        </CardHeader>

        <Separator />

        {/* Scrollable Content */}
        <ScrollArea className="flex-1">
          <CardContent className="pt-4 pb-2 space-y-4">
            {/* Quick Stats Grid */}
            <ServerQuickStats 
              server={selectedServer} 
              drives={drives || undefined} 
              nics={nics || undefined} 
            />

            <Separator />

            {/* System Information */}
            <ServerSystemInfo server={selectedServer} />

            <Separator />

            {/* Network Interfaces with MACs */}
            <ServerNicsSummary 
              nics={nics || []} 
              isLoading={nicsLoading}
              onViewAll={() => onViewProperties(selectedServer)}
            />

            <Separator />

            {/* Storage */}
            <ServerStorageSummary
              drives={drives || []}
              isLoading={drivesLoading}
              totalStorageTB={selectedServer.total_storage_tb}
              onViewAll={() => onViewProperties(selectedServer)}
            />

            <Separator />

            {/* Connectivity */}
            <ServerConnectivity
              server={selectedServer}
              onAssignCredentials={() => onAssignCredentials(selectedServer)}
              onLinkVCenter={handleAutoLinkVCenter}
            />
          </CardContent>
        </ScrollArea>

        <Separator />

        {/* Actions Section - Fixed at bottom */}
        <div className="p-4 flex-shrink-0">
          <ServerActions
            server={selectedServer}
            refreshing={refreshing}
            testing={testing}
            launchingConsole={launchingConsole}
            onTestConnection={() => onTestConnection(selectedServer)}
            onRefreshInfo={() => onRefreshInfo(selectedServer)}
            onPowerControl={() => onPowerControl(selectedServer)}
            onLaunchConsole={handleLaunchConsole}
            onBiosConfig={() => onBiosConfig(selectedServer)}
            onBootConfig={() => onBootConfig(selectedServer)}
            onVirtualMedia={() => onVirtualMedia(selectedServer)}
            onScpBackup={() => onScpBackup(selectedServer)}
            onNetworkSettings={() => onNetworkSettings(selectedServer)}
            onViewEventLog={() => onViewEventLog(selectedServer)}
            onViewHealth={() => onViewHealth(selectedServer)}
            onViewAudit={() => onViewAudit(selectedServer)}
            onAssignCredentials={() => onAssignCredentials(selectedServer)}
            onLinkVCenter={handleAutoLinkVCenter}
            onViewProperties={() => onViewProperties(selectedServer)}
            onWorkflow={() => onWorkflow(selectedServer)}
            onCreateJob={() => onCreateJob(selectedServer)}
            onEdit={() => onEdit(selectedServer)}
            onDelete={() => onDelete(selectedServer)}
          />
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
        {/* Status Bar - green if all online, yellow if mixed */}
        <div className={`h-1.5 ${offlineCount === 0 ? "bg-success" : onlineCount > 0 ? "bg-warning" : "bg-destructive"}`} />

        <CardHeader className="pb-3 pt-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold">{selectedGroup.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedGroup.servers.length} Servers
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="flex-1 overflow-auto pt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-3 rounded-lg bg-muted/50 border border-border/50">
              <p className="text-2xl font-semibold">{selectedGroup.servers.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-success/10 border border-success/20">
              <p className="text-2xl font-semibold text-success">{onlineCount}</p>
              <p className="text-xs text-muted-foreground">Online</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-2xl font-semibold text-destructive">{offlineCount}</p>
              <p className="text-xs text-muted-foreground">Offline</p>
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
      <div className="h-1.5 bg-muted" />
      
      <CardHeader className="pb-3 pt-3">
        <h3 className="text-base font-semibold">Server Details</h3>
        <p className="text-xs text-muted-foreground">
          Select a server or group to view details
        </p>
      </CardHeader>

      <Separator />

      <CardContent className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <ServerIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No server selected</p>
          <p className="text-xs mt-1">Click on a server row to view details</p>
        </div>
      </CardContent>
    </Card>
  );
}
