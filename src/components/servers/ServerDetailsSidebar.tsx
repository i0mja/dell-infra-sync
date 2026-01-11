import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  X,
  Server as ServerIcon,
  RefreshCw,
  Wrench,
  Clock,
} from "lucide-react";
import type { Server } from "@/hooks/useServers";
import { useServerDrives } from "@/hooks/useServerDrives";
import { useServerNics } from "@/hooks/useServerNics";
import { useServerMemory } from "@/hooks/useServerMemory";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import {
  ServerActions,
  ServerHardwareSummaryList,
  ServerAlertsSection,
  ServerTasksSection,
  ServerPerformanceGauges,
  ServerSidebarTabs,
  ServerQuickActionBar,
  ServerStorageSummary,
  ServerMemorySummary,
  ServerNicsSummary,
} from "./sidebar";

interface GroupData {
  id: string;
  name: string;
  type?: 'manual' | 'vcenter';
  servers: Server[];
  onlineCount: number;
  linkedCount: number;
}

interface ServerDetailsSidebarProps {
  selectedServer: Server | null;
  selectedGroup: GroupData | null;
  hardwareIssues?: Map<string, { drive_issues: number; memory_issues: number; has_critical?: boolean; has_warning?: boolean }>;
  isRefreshing?: boolean;
  isTesting?: boolean;
  isLaunchingConsole?: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onTestConnection?: () => void;
  onRefreshInfo?: () => void;
  onPowerControl?: () => void;
  onBiosConfig?: () => void;
  onBootConfig?: () => void;
  onVirtualMedia?: () => void;
  onScpBackup?: () => void;
  onViewEventLog?: () => void;
  onViewHealth?: () => void;
  onViewAudit?: () => void;
  onViewProperties?: () => void;
  onWorkflow?: () => void;
  onLinkVCenter?: () => void;
  onAssignCredentials?: () => void;
  onCreateJob?: () => void;
  onNetworkSettings?: () => void;
  onIdracSettings?: () => void;
  onLaunchConsole?: () => void;
  onCheckForUpdates?: () => void;
}

// Status bar color based on connection status
function getStatusBarColor(status: string | null, isDegraded: boolean, hasCritical: boolean): string {
  if (status === "online" && isDegraded) {
    return hasCritical ? "bg-destructive" : "bg-amber-500";
  }
  switch (status) {
    case "online":
      return "bg-success";
    case "offline":
      return "bg-muted"; // Grey for offline (not red - it's not an error state)
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
  hardwareIssues,
  isRefreshing,
  isTesting,
  isLaunchingConsole,
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
  onIdracSettings,
  onLaunchConsole,
  onCheckForUpdates,
}: ServerDetailsSidebarProps) {
  // Tab state for sidebar views
  const [activeTab, setActiveTab] = useState<"dashboard" | "hardware" | "tasks" | "settings">("dashboard");

  // Fetch drives, NICs, and memory for selected server
  const { data: drives } = useServerDrives(selectedServer?.id || null);
  const { data: nics } = useServerNics(selectedServer?.id || null);
  const { data: memory } = useServerMemory(selectedServer?.id);

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
    onLinkVCenter?.();
  };

  // Server Details View
  if (selectedServer) {
    // Check for hardware issues (degraded status)
    const issues = hardwareIssues?.get(selectedServer.id);
    const isDegraded = selectedServer.connection_status === "online" && 
                       ((issues?.drive_issues || 0) + (issues?.memory_issues || 0)) > 0;
    const hasCritical = issues?.has_critical || false;

    const statusBadgeColors: Record<string, string> = {
      online: "bg-success text-success-foreground",
      offline: "bg-muted text-muted-foreground", // Grey for offline
      unknown: "bg-muted text-muted-foreground",
    };

    return (
      <div className="w-[440px] flex-shrink-0 border-l bg-card h-full flex flex-col overflow-hidden">
        {/* Status Bar */}
        <div className={`h-1.5 ${getStatusBarColor(selectedServer.connection_status, isDegraded, hasCritical)}`} />

        {/* Header */}
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold truncate">
                {selectedServer.hostname || selectedServer.idrac_hostname || selectedServer.ip_address}
              </h3>
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                <p className="font-mono">{selectedServer.ip_address}</p>
                {/* Show iDRAC-reported hostname when it differs from display name */}
                {selectedServer.hostname && selectedServer.idrac_hostname && 
                 selectedServer.hostname !== selectedServer.idrac_hostname && (
                  <p className="text-muted-foreground/70 italic">
                    iDRAC: {selectedServer.idrac_hostname}
                  </p>
                )}
                <p className="truncate">{selectedServer.model || "Unknown Model"}</p>
                {selectedServer.service_tag && (
                  <p className="font-mono">{selectedServer.service_tag}</p>
                )}
                {/* Location info */}
                {(selectedServer.datacenter || selectedServer.rack_id || selectedServer.rack_position) && (
                  <p className="flex items-center gap-1 text-muted-foreground">
                    <span>📍</span>
                    <span className="truncate">
                      {[
                        selectedServer.datacenter,
                        selectedServer.rack_id,
                        selectedServer.rack_position
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </p>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 -mr-1" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Status Badges */}
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className={
                    isDegraded 
                      ? (hasCritical ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white")
                      : statusBadgeColors[selectedServer.connection_status || "unknown"]
                  }>
                    {isDegraded ? (hasCritical ? "Critical" : "Warning") : (selectedServer.connection_status || "Unknown")}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Last seen: {selectedServer.last_seen 
                      ? formatDistanceToNow(new Date(selectedServer.last_seen), { addSuffix: true })
                      : "Never"}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {selectedServer.overall_health && selectedServer.overall_health !== "OK" && (
              <Badge variant={getHealthBadgeVariant(selectedServer.overall_health)}>
                {selectedServer.overall_health === "Warning" ? "1 Issue" : selectedServer.overall_health}
              </Badge>
            )}
            {selectedServer.power_state && (
              <Badge variant="outline" className="capitalize">
                Power: {selectedServer.power_state}
              </Badge>
            )}
          </div>
        </CardHeader>

        <Separator />

        {/* Scrollable Content - Dashboard View */}
        <ScrollArea className="flex-1">
          <CardContent className="pt-3 pb-2 space-y-4">
            {activeTab === "dashboard" && (
              <>
                {/* Quick Action Bar */}
                <ServerQuickActionBar
                  onLaunchConsole={onLaunchConsole}
                  onSync={onRefreshInfo}
                  onCheckForUpdates={onCheckForUpdates}
                  onPowerControl={onPowerControl}
                  onViewHealth={onViewHealth}
                  onSettings={() => setActiveTab("settings")}
                  isRefreshing={isRefreshing}
                  isLaunchingConsole={isLaunchingConsole}
                />

                <Separator />

                {/* Hardware Summary List */}
                <ServerHardwareSummaryList 
                  server={selectedServer} 
                  drives={drives || undefined} 
                  nics={nics || undefined}
                  memory={memory || undefined}
                />

                <Separator />

                {/* Alerts Section */}
                <ServerAlertsSection serverId={selectedServer.id} />

                {/* Tasks Section */}
                <ServerTasksSection serverId={selectedServer.id} />

                <Separator />

                {/* Performance Gauges */}
                <ServerPerformanceGauges 
                  server={selectedServer} 
                  drives={drives || undefined} 
                />
              </>
            )}

            {activeTab === "hardware" && (
              <div className="space-y-4">
                {/* CPU Details */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Processors
                  </h4>
                  <div className="p-2 rounded-md bg-muted/30 text-sm">
                    <p className="font-medium">{selectedServer.cpu_model || "Unknown CPU"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selectedServer.cpu_count || 0} x {selectedServer.cpu_cores_per_socket || 0} Cores
                    </p>
                  </div>
                </div>

                {/* Full Memory Summary */}
                <ServerMemorySummary server={selectedServer} />

                {/* Full Storage Summary */}
                <ServerStorageSummary drives={drives || []} />

                {/* Full Network Summary */}
                <ServerNicsSummary nics={nics || []} />
              </div>
            )}

            {activeTab === "tasks" && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                <p>Tasks view</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={onViewAudit}
                >
                  View Full Activity
                </Button>
              </div>
            )}

            {activeTab === "settings" && (
              <div className="space-y-2">
                <ServerActions
                  server={selectedServer}
                  refreshing={isRefreshing}
                  testing={isTesting}
                  launchingConsole={isLaunchingConsole}
                  onTestConnection={onTestConnection}
                  onRefreshInfo={onRefreshInfo}
                  onPowerControl={onPowerControl}
                  onLaunchConsole={onLaunchConsole}
                  onBiosConfig={onBiosConfig}
                  onBootConfig={onBootConfig}
                  onVirtualMedia={onVirtualMedia}
                  onScpBackup={onScpBackup}
                  onNetworkSettings={onNetworkSettings}
                  onIdracSettings={onIdracSettings}
                  onViewEventLog={onViewEventLog}
                  onViewHealth={onViewHealth}
                  onViewAudit={onViewAudit}
                  onAssignCredentials={onAssignCredentials}
                  onLinkVCenter={handleAutoLinkVCenter}
                  onViewProperties={onViewProperties}
                  onWorkflow={onWorkflow}
                  onCreateJob={onCreateJob}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </div>
            )}
          </CardContent>
        </ScrollArea>

        {/* Bottom Tab Navigation */}
        <ServerSidebarTabs activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
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
      <div className="w-[440px] flex-shrink-0 border-l bg-card h-full flex flex-col">
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
      </div>
    );
  }

  // Empty State
  return (
    <div className="w-[440px] flex-shrink-0 border-l bg-card h-full flex flex-col">
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
    </div>
  );
}
