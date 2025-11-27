import { Server } from "@/hooks/useServers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Server as ServerIcon,
  Cpu,
  HardDrive,
  Network,
  Zap,
  RefreshCw,
  Power,
  Settings,
  FileText,
  HardDriveDownload,
  FileJson,
  ShieldCheck,
  Activity,
  Link as LinkIcon,
} from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface ServerDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: Server | null;
  onRefresh?: () => void;
  onPowerControl?: () => void;
  onBiosConfig?: () => void;
  onBootConfig?: () => void;
  onScpBackup?: () => void;
  onVirtualMedia?: () => void;
  onEventLog?: () => void;
  onHealthCheck?: () => void;
  onLinkVCenter?: () => void;
  onAudit?: () => void;
}

export function ServerDetailDialog({
  open,
  onOpenChange,
  server,
  onRefresh,
  onPowerControl,
  onBiosConfig,
  onBootConfig,
  onScpBackup,
  onVirtualMedia,
  onEventLog,
  onHealthCheck,
  onLinkVCenter,
  onAudit,
}: ServerDetailDialogProps) {
  const isDesktop = useMediaQuery("(min-width: 1280px)");

  if (!server) return null;

  const content = (
    <Tabs defaultValue="overview" className="h-full flex flex-col">
      <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0 gap-2">
        <TabsTrigger
          value="overview"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2"
        >
          Overview
        </TabsTrigger>
        <TabsTrigger
          value="hardware"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2"
        >
          Hardware
        </TabsTrigger>
        <TabsTrigger
          value="actions"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2"
        >
          Actions
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="flex-1 mt-0">
        <ScrollArea className="h-full">
          <div className="p-6 space-y-6">
            {/* System Information */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ServerIcon className="h-4 w-4" />
                System Information
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-medium">{server.model || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Service Tag</span>
                  <span className="font-medium">{server.service_tag || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Manufacturer</span>
                  <span className="font-medium">{server.manufacturer || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">BIOS Version</span>
                  <span className="font-medium">{server.bios_version || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">iDRAC Firmware</span>
                  <span className="font-medium">{server.idrac_firmware || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Redfish Version</span>
                  <span className="font-medium">{server.redfish_version || "N/A"}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Status */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Status
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Overall Health</span>
                  <Badge variant={server.overall_health === "OK" ? "default" : "destructive"}>
                    {server.overall_health || "Unknown"}
                  </Badge>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Power State</span>
                  <Badge variant={server.power_state === "On" ? "default" : "secondary"}>
                    {server.power_state || "Unknown"}
                  </Badge>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Last Seen</span>
                  <span className="font-medium">
                    {server.last_seen
                      ? new Date(server.last_seen).toLocaleString()
                      : "Never"}
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            {/* vCenter Integration */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />
                vCenter Integration
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={server.vcenter_host_id ? "default" : "secondary"}>
                    {server.vcenter_host_id ? "Linked" : "Not Linked"}
                  </Badge>
                </div>
                {!server.vcenter_host_id && onLinkVCenter && (
                  <Button
                    onClick={onLinkVCenter}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <LinkIcon className="mr-2 h-4 w-4" />
                    Link to vCenter Host
                  </Button>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="hardware" className="flex-1 mt-0">
        <ScrollArea className="h-full">
          <div className="p-6 space-y-6">
            {/* Processor */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Processor
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-medium">{server.cpu_model || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Count</span>
                  <span className="font-medium">{server.cpu_count || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Cores per Socket</span>
                  <span className="font-medium">{server.cpu_cores_per_socket || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Speed</span>
                  <span className="font-medium">{server.cpu_speed || "N/A"}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Memory */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Memory
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Total Memory</span>
                  <span className="font-medium">{server.memory_gb ? `${server.memory_gb} GB` : "N/A"}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Storage */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Storage
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Total Drives</span>
                  <span className="font-medium">{server.total_drives || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Total Storage</span>
                  <span className="font-medium">
                    {server.total_storage_tb ? `${server.total_storage_tb} TB` : "N/A"}
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Boot Configuration */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <HardDriveDownload className="h-4 w-4" />
                Boot Configuration
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Boot Mode</span>
                  <span className="font-medium">{server.boot_mode || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Secure Boot</span>
                  <span className="font-medium">{server.secure_boot || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Virtualization</span>
                  <Badge variant={server.virtualization_enabled ? "default" : "secondary"}>
                    {server.virtualization_enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="actions" className="flex-1 mt-0">
        <ScrollArea className="h-full">
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {onRefresh && (
                <Button onClick={onRefresh} variant="outline" className="w-full justify-start">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh Info
                </Button>
              )}
              {onPowerControl && (
                <Button onClick={onPowerControl} variant="outline" className="w-full justify-start">
                  <Power className="mr-2 h-4 w-4" />
                  Power Control
                </Button>
              )}
              {onBiosConfig && (
                <Button onClick={onBiosConfig} variant="outline" className="w-full justify-start">
                  <Settings className="mr-2 h-4 w-4" />
                  BIOS Config
                </Button>
              )}
              {onBootConfig && (
                <Button onClick={onBootConfig} variant="outline" className="w-full justify-start">
                  <HardDriveDownload className="mr-2 h-4 w-4" />
                  Boot Config
                </Button>
              )}
              {onScpBackup && (
                <Button onClick={onScpBackup} variant="outline" className="w-full justify-start">
                  <FileJson className="mr-2 h-4 w-4" />
                  SCP Backup
                </Button>
              )}
              {onVirtualMedia && (
                <Button onClick={onVirtualMedia} variant="outline" className="w-full justify-start">
                  <HardDrive className="mr-2 h-4 w-4" />
                  Virtual Media
                </Button>
              )}
              {onEventLog && (
                <Button onClick={onEventLog} variant="outline" className="w-full justify-start">
                  <FileText className="mr-2 h-4 w-4" />
                  Event Log
                </Button>
              )}
              {onHealthCheck && (
                <Button onClick={onHealthCheck} variant="outline" className="w-full justify-start">
                  <Activity className="mr-2 h-4 w-4" />
                  Health Check
                </Button>
              )}
              {onAudit && (
                <Button onClick={onAudit} variant="outline" className="w-full justify-start">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Server Audit
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] p-0 flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-xl flex items-center gap-3">
              <ServerIcon className="h-5 w-5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">
                  {server.hostname || server.ip_address}
                </div>
                {server.hostname && (
                  <div className="text-sm text-muted-foreground font-normal">
                    {server.ip_address}
                  </div>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">{content}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="text-xl flex items-center gap-3">
            <ServerIcon className="h-5 w-5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">
                {server.hostname || server.ip_address}
              </div>
              {server.hostname && (
                <div className="text-sm text-muted-foreground font-normal">
                  {server.ip_address}
                </div>
              )}
            </div>
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-hidden">{content}</div>
      </SheetContent>
    </Sheet>
  );
}
