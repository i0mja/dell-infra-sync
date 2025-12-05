import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  X,
  Server as ServerIcon,
  RefreshCw,
  Activity,
  Power,
  Settings,
  Monitor,
  ChevronDown,
  Cpu,
  HardDrive,
  Zap,
  Thermometer,
  Clock,
  Link,
  MoreHorizontal,
  Network,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Server } from "@/hooks/useServers";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ServerQuickViewProps {
  server: Server;
  onClose: () => void;
  onRefresh: () => void;
  onPowerControl: () => void;
  onBiosConfig: () => void;
  onBootConfig: () => void;
  onScpBackup: () => void;
  onVirtualMedia: () => void;
  onEventLog: () => void;
  onHealthCheck: () => void;
  onConsoleLaunch: () => void;
  onLinkVCenter: () => void;
  onAudit: () => void;
  onNetworkSettings?: () => void;
  refreshing?: boolean;
}

export function ServerQuickView({
  server,
  onClose,
  onRefresh,
  onPowerControl,
  onBiosConfig,
  onBootConfig,
  onScpBackup,
  onVirtualMedia,
  onEventLog,
  onHealthCheck,
  onConsoleLaunch,
  onLinkVCenter,
  onAudit,
  onNetworkSettings,
  refreshing = false,
}: ServerQuickViewProps) {
  const [systemInfoOpen, setSystemInfoOpen] = useState(true);
  const [hardwareOpen, setHardwareOpen] = useState(false);

  const statusColors = {
    online: "bg-success text-success-foreground",
    offline: "bg-destructive text-destructive-foreground",
    unknown: "bg-muted text-muted-foreground",
  };

  const healthColors = {
    OK: "bg-success/10 text-success border-success/20",
    Warning: "bg-warning/10 text-warning border-warning/20",
    Critical: "bg-destructive/10 text-destructive border-destructive/20",
  };

  const getTotalCores = () => {
    if (!server.cpu_count || !server.cpu_cores_per_socket) return null;
    return server.cpu_count * server.cpu_cores_per_socket;
  };

  const getStorageDisplay = () => {
    const parts = [];
    if (server.total_drives) parts.push(`${server.total_drives} drives`);
    if (server.total_storage_tb) parts.push(`${server.total_storage_tb}TB`);
    return parts.length > 0 ? parts.join(", ") : "N/A";
  };

  return (
    <div className="w-80 h-full border-l bg-background flex flex-col flex-shrink-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate">
              {server.hostname || server.ip_address}
            </h3>
            {server.hostname && (
              <p className="text-xs text-muted-foreground font-mono truncate">
                {server.ip_address}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {server.model || "Unknown Model"}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            className={cn("text-xs", statusColors[server.connection_status || "unknown"])}
          >
            {server.connection_status || "Unknown"}
          </Badge>
          {server.overall_health && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                healthColors[server.overall_health as keyof typeof healthColors] ||
                  "bg-muted"
              )}
            >
              {server.overall_health}
            </Badge>
          )}
          {server.power_state && (
            <Badge variant="outline" className="text-xs">
              {server.power_state}
            </Badge>
          )}
          {server.vcenter_host_id && (
            <Badge variant="secondary" className="text-xs">
              <Link className="h-3 w-3 mr-1" />
              vCenter
            </Badge>
          )}
        </div>
      </div>

      {/* Key Stats Grid */}
      <div className="p-4 border-b">
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Cpu className="h-3 w-3" />
              <span>CPU</span>
            </div>
            <div className="font-medium">
              {server.cpu_count ? (
                <span>
                  {server.cpu_count}x
                  {getTotalCores() && <span className="text-muted-foreground ml-0.5">({getTotalCores()}c)</span>}
                </span>
              ) : (
                "N/A"
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <HardDrive className="h-3 w-3" />
              <span>Memory</span>
            </div>
            <div className="font-medium">{server.memory_gb ? `${server.memory_gb} GB` : "N/A"}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <HardDrive className="h-3 w-3" />
              <span>Storage</span>
            </div>
            <div className="font-medium text-xs leading-tight">{getStorageDisplay()}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Zap className="h-3 w-3" />
              <span>Power</span>
            </div>
            <div className="font-medium capitalize">{server.power_state || "Unknown"}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Thermometer className="h-3 w-3" />
              <span>Health</span>
            </div>
            <div className="font-medium">{server.overall_health || "Unknown"}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Seen</span>
            </div>
            <div className="font-medium text-xs leading-tight">
              {server.last_seen
                ? formatDistanceToNow(new Date(server.last_seen), { addSuffix: true })
                    .replace("about ", "")
                    .replace(" ago", "")
                : "Never"}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="p-4 border-b">
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={onConsoleLaunch}
            title="Launch Console"
          >
            <Monitor className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={onPowerControl}
            title="Power Control"
          >
            <Power className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh Info"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={onHealthCheck}
            title="Health Check"
          >
            <Activity className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9" title="More Actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onBiosConfig}>
                <Settings className="mr-2 h-4 w-4" />
                BIOS Config
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onBootConfig}>
                <Settings className="mr-2 h-4 w-4" />
                Boot Config
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onScpBackup}>
                <HardDrive className="mr-2 h-4 w-4" />
                SCP Backup
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onVirtualMedia}>
                <HardDrive className="mr-2 h-4 w-4" />
                Virtual Media
              </DropdownMenuItem>
              {onNetworkSettings && (
                <DropdownMenuItem onClick={onNetworkSettings}>
                  <Network className="mr-2 h-4 w-4" />
                  Network Settings
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onEventLog}>
                Event Log
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAudit}>
                Server Audit
              </DropdownMenuItem>
              {!server.vcenter_host_id && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onLinkVCenter}>
                    <Link className="mr-2 h-4 w-4" />
                    Link to vCenter
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Scrollable Details */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {/* System Information - Collapsible */}
          <Collapsible open={systemInfoOpen} onOpenChange={setSystemInfoOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-semibold hover:text-foreground/80 transition-colors">
              <span>System Information</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  systemInfoOpen && "transform rotate-180"
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                  <span className="text-muted-foreground">Service Tag</span>
                  <span className="font-mono text-right">{server.service_tag || "N/A"}</span>

                  <span className="text-muted-foreground">Manufacturer</span>
                  <span className="text-right">{server.manufacturer || "N/A"}</span>

                  <span className="text-muted-foreground">iDRAC FW</span>
                  <span className="font-mono text-right">{server.idrac_firmware || "N/A"}</span>

                  <span className="text-muted-foreground">BIOS</span>
                  <span className="font-mono text-right">{server.bios_version || "N/A"}</span>

                  <span className="text-muted-foreground">Redfish</span>
                  <span className="font-mono text-right">{server.redfish_version || "N/A"}</span>

                  {server.boot_mode && (
                    <>
                      <span className="text-muted-foreground">Boot Mode</span>
                      <span className="text-right">{server.boot_mode}</span>
                    </>
                  )}

                  {server.secure_boot && (
                    <>
                      <span className="text-muted-foreground">Secure Boot</span>
                      <span className="text-right">{server.secure_boot}</span>
                    </>
                  )}

                  {server.virtualization_enabled !== null && (
                    <>
                      <span className="text-muted-foreground">Virtualization</span>
                      <span className="text-right">
                        {server.virtualization_enabled ? "Enabled" : "Disabled"}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* Hardware Details - Collapsible */}
          <Collapsible open={hardwareOpen} onOpenChange={setHardwareOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-semibold hover:text-foreground/80 transition-colors">
              <span>Hardware Details</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  hardwareOpen && "transform rotate-180"
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <div className="space-y-3 text-xs">
                {server.cpu_model && (
                  <div>
                    <div className="text-muted-foreground mb-1">Processor</div>
                    <div className="font-medium leading-tight">{server.cpu_model}</div>
                    {server.cpu_speed && (
                      <div className="text-muted-foreground mt-0.5">{server.cpu_speed}</div>
                    )}
                  </div>
                )}

                {(server.memory_gb || server.total_drives || server.total_storage_tb) && (
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                    {server.memory_gb && (
                      <>
                        <span className="text-muted-foreground">Total Memory</span>
                        <span className="font-medium text-right">{server.memory_gb} GB</span>
                      </>
                    )}

                    {server.total_drives && (
                      <>
                        <span className="text-muted-foreground">Total Drives</span>
                        <span className="font-medium text-right">{server.total_drives}</span>
                      </>
                    )}

                    {server.total_storage_tb && (
                      <>
                        <span className="text-muted-foreground">Total Storage</span>
                        <span className="font-medium text-right">
                          {server.total_storage_tb} TB
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  );
}
