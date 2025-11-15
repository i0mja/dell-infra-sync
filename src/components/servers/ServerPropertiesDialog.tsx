import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Edit, Server as ServerIcon, Cpu, HardDrive, Network, Wifi, Clock } from "lucide-react";
import { format } from "date-fns";

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
  service_tag: string | null;
  idrac_firmware: string | null;
  bios_version: string | null;
  cpu_count: number | null;
  memory_gb: number | null;
  connection_status: 'online' | 'offline' | 'unknown' | null;
  connection_error: string | null;
  last_seen: string | null;
  last_connection_test: string | null;
  credential_test_status: string | null;
  credential_last_tested: string | null;
  created_at: string;
  notes: string | null;
  vcenter_host_id: string | null;
  discovery_job_id: string | null;
}

interface ServerPropertiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: Server | null;
  onEdit?: () => void;
}

export function ServerPropertiesDialog({
  open,
  onOpenChange,
  server,
  onEdit,
}: ServerPropertiesDialogProps) {
  if (!server) return null;

  const getStatusBadge = () => {
    if (server.discovery_job_id) {
      return <Badge variant="secondary">Discovering</Badge>;
    }
    if (server.model && server.service_tag && server.idrac_firmware) {
      return <Badge variant="default">Discovered</Badge>;
    }
    return <Badge variant="outline">Minimal Info</Badge>;
  };

  const getConnectionStatusBadge = () => {
    const status = server.connection_status;
    if (status === 'online') {
      return <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">Online</Badge>;
    }
    if (status === 'offline') {
      return <Badge className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">Offline</Badge>;
    }
    return <Badge variant="outline">Unknown</Badge>;
  };

  const getCredentialStatusBadge = () => {
    const status = server.credential_test_status;
    if (status === 'valid') {
      return <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">Valid</Badge>;
    }
    if (status === 'invalid') {
      return <Badge className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">Invalid</Badge>;
    }
    return <Badge variant="outline">Unknown</Badge>;
  };

  const formatDate = (date: string | null) => {
    if (!date) return "N/A";
    try {
      return format(new Date(date), "MMM d, yyyy h:mm a");
    } catch {
      return "N/A";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ServerIcon className="h-5 w-5" />
            Server Properties
          </DialogTitle>
          <DialogDescription>
            {server.hostname || server.ip_address}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="hardware" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="hardware">
              <Cpu className="h-4 w-4 mr-2" />
              Hardware
            </TabsTrigger>
            <TabsTrigger value="firmware">
              <HardDrive className="h-4 w-4 mr-2" />
              Firmware
            </TabsTrigger>
            <TabsTrigger value="network">
              <Network className="h-4 w-4 mr-2" />
              Network
            </TabsTrigger>
          </TabsList>

          <TabsContent value="hardware" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Model</p>
                <p className="font-medium">{server.model || "N/A"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Service Tag</p>
                <p className="font-medium">{server.service_tag || "N/A"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">CPU Count</p>
                <p className="font-medium">
                  {server.cpu_count ? `${server.cpu_count} processor${server.cpu_count > 1 ? 's' : ''}` : "N/A"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total Memory</p>
                <p className="font-medium">
                  {server.memory_gb ? `${server.memory_gb} GB` : "N/A"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Status</p>
                <div>{getStatusBadge()}</div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Created At</p>
                <p className="font-medium text-sm">{formatDate(server.created_at)}</p>
              </div>
            </div>
            {server.notes && (
              <div className="space-y-1 pt-2 border-t">
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="text-sm">{server.notes}</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="firmware" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">iDRAC Firmware</p>
                <p className="font-medium">{server.idrac_firmware || "N/A"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">BIOS Version</p>
                <p className="font-medium">{server.bios_version || "N/A"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Last Updated</p>
                <p className="font-medium text-sm">{formatDate(server.last_seen)}</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="network" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">IP Address</p>
                <p className="font-medium font-mono">{server.ip_address}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Hostname</p>
                <p className="font-medium">{server.hostname || "N/A"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Connection Status</p>
                <div>{getConnectionStatusBadge()}</div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Last Seen</p>
                <p className="font-medium text-sm flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDate(server.last_seen)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Last Connection Test</p>
                <p className="font-medium text-sm">{formatDate(server.last_connection_test)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Credential Status</p>
                <div>{getCredentialStatusBadge()}</div>
              </div>
              {server.credential_last_tested && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Last Credential Test</p>
                  <p className="font-medium text-sm">{formatDate(server.credential_last_tested)}</p>
                </div>
              )}
            </div>
            {server.connection_error && (
              <div className="space-y-1 pt-2 border-t">
                <p className="text-sm text-muted-foreground">Connection Error</p>
                <p className="text-sm text-red-600 dark:text-red-400 font-mono">{server.connection_error}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onEdit && (
            <Button onClick={onEdit}>
              <Edit className="mr-2 h-4 w-4" />
              Edit Server
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
