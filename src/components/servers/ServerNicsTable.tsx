import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Check, Wifi, WifiOff, Network, Info } from "lucide-react";
import { useServerNics, ServerNic } from "@/hooks/useServerNics";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface ServerNicsTableProps {
  serverId: string | null;
}

export function ServerNicsTable({ serverId }: ServerNicsTableProps) {
  const { data: nics, isLoading, error } = useServerNics(serverId);
  const [copiedMac, setCopiedMac] = useState<string | null>(null);

  const copyToClipboard = async (mac: string) => {
    try {
      await navigator.clipboard.writeText(mac);
      setCopiedMac(mac);
      toast.success("MAC address copied to clipboard");
      setTimeout(() => setCopiedMac(null), 2000);
    } catch {
      toast.error("Failed to copy MAC address");
    }
  };

  const formatSpeed = (speedMbps: number | null) => {
    if (!speedMbps) return "N/A";
    if (speedMbps >= 1000) {
      return `${speedMbps / 1000} Gbps`;
    }
    return `${speedMbps} Mbps`;
  };

  const getLinkStatusBadge = (status: string | null) => {
    if (!status) return <Badge variant="outline">Unknown</Badge>;
    
    const normalized = status.toLowerCase();
    if (normalized === 'up' || normalized === 'linkup') {
      return (
        <Badge className="bg-success/10 text-success border-success/20">
          <Wifi className="h-3 w-3 mr-1" />
          Up
        </Badge>
      );
    }
    if (normalized === 'down' || normalized === 'linkdown' || normalized === 'nolink') {
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          <WifiOff className="h-3 w-3 mr-1" />
          Down
        </Badge>
      );
    }
    return <Badge variant="outline">{status}</Badge>;
  };

  const getHealthBadge = (health: string | null) => {
    if (!health) return null;
    
    const normalized = health.toLowerCase();
    if (normalized === 'ok') {
      return <Badge className="bg-success/10 text-success border-success/20">OK</Badge>;
    }
    if (normalized === 'warning') {
      return <Badge className="bg-warning/10 text-warning border-warning/20">Warning</Badge>;
    }
    if (normalized === 'critical') {
      return <Badge variant="destructive">Critical</Badge>;
    }
    return <Badge variant="outline">{health}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        <p>Failed to load NIC information</p>
        <p className="text-sm text-muted-foreground">{String(error)}</p>
      </div>
    );
  }

  if (!nics || nics.length === 0) {
    return (
      <div className="text-center py-8">
        <Network className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">No NIC information available</p>
        <p className="text-sm text-muted-foreground mt-1">
          Run a server discovery to collect NIC data
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {nics.length} network interface{nics.length !== 1 ? 's' : ''} found
        </div>
        
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Port</TableHead>
                <TableHead className="w-[180px]">MAC Address</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="w-[100px]">Speed</TableHead>
                <TableHead className="w-[80px]">Link</TableHead>
                <TableHead className="w-[80px]">Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nics.map((nic) => (
                <TableRow key={nic.id}>
                  <TableCell className="font-mono text-sm">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help">
                          {nic.fqdd}
                          {nic.name && (
                            <div className="text-xs text-muted-foreground truncate max-w-[120px]">
                              {nic.name}
                            </div>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-[300px]">
                        <div className="space-y-1">
                          <p><strong>FQDD:</strong> {nic.fqdd}</p>
                          {nic.name && <p><strong>Name:</strong> {nic.name}</p>}
                          {nic.description && <p><strong>Description:</strong> {nic.description}</p>}
                          {nic.serial_number && <p><strong>Serial:</strong> {nic.serial_number}</p>}
                          {nic.part_number && <p><strong>Part #:</strong> {nic.part_number}</p>}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {nic.mac_address ? (
                      <div className="flex items-center gap-1">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                          {nic.mac_address}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => copyToClipboard(nic.mac_address!)}
                        >
                          {copiedMac === nic.mac_address ? (
                            <Check className="h-3 w-3 text-success" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                        {nic.permanent_mac_address && nic.permanent_mac_address !== nic.mac_address && (
                          <Tooltip>
                            <TooltipTrigger>
                              <Info className="h-3 w-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Permanent MAC: {nic.permanent_mac_address}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[200px]">
                      <div className="text-sm truncate">{nic.model || "Unknown"}</div>
                      {nic.manufacturer && (
                        <div className="text-xs text-muted-foreground truncate">
                          {nic.manufacturer}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">
                          {formatSpeed(nic.current_speed_mbps)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <p>Current: {formatSpeed(nic.current_speed_mbps)}</p>
                          <p>Max: {formatSpeed(nic.max_speed_mbps)}</p>
                          {nic.duplex && <p>Duplex: {nic.duplex}</p>}
                          {nic.auto_negotiate !== null && (
                            <p>Auto-negotiate: {nic.auto_negotiate ? 'Yes' : 'No'}</p>
                          )}
                          {nic.mtu && <p>MTU: {nic.mtu}</p>}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {getLinkStatusBadge(nic.link_status)}
                  </TableCell>
                  <TableCell>
                    {getHealthBadge(nic.health)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Switch Connections Section */}
        {nics.some(nic => nic.switch_name || nic.switch_connection_id) && (
          <div className="border rounded-lg p-4 space-y-2">
            <h4 className="text-sm font-semibold">Switch Connections (LLDP)</h4>
            <div className="space-y-2">
              {nics.filter(nic => nic.switch_name || nic.switch_connection_id).map(nic => (
                <div key={`switch-${nic.id}`} className="flex items-center justify-between text-sm">
                  <span className="font-mono">{nic.fqdd}</span>
                  <span className="text-muted-foreground">
                    {nic.switch_name || nic.switch_connection_id}
                    {nic.switch_port_description && ` (${nic.switch_port_description})`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
