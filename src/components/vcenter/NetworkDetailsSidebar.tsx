import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { X, Network, Wifi, Server, Monitor, Loader2, MapPin } from "lucide-react";
import { useNetworkVms } from "@/hooks/useNetworkVms";
import type { VCenterNetwork } from "@/hooks/useVCenterData";

interface NetworkDetailsSidebarProps {
  network: VCenterNetwork | null;
  groupedNetworks?: VCenterNetwork[];
  selectedVCenterId?: string | null;
  onClose: () => void;
  vcenterName?: string;
  vcenterMap?: Map<string, string>;
}

export function NetworkDetailsSidebar({
  network,
  groupedNetworks,
  selectedVCenterId,
  onClose,
  vcenterName,
  vcenterMap = new Map(),
}: NetworkDetailsSidebarProps) {
  // Get all network IDs from the group (or single network)
  const networkIds = useMemo(() => {
    if (groupedNetworks && groupedNetworks.length > 0) {
      return groupedNetworks.map(n => n.id);
    }
    return network?.id || null;
  }, [network, groupedNetworks]);

  // Pass vCenter filter to respect dropdown selection
  const { vms, loading, error } = useNetworkVms(networkIds, selectedVCenterId);

  // Calculate total stats from grouped networks
  const totalStats = useMemo(() => {
    if (groupedNetworks && groupedNetworks.length > 0) {
      return {
        hostCount: groupedNetworks.reduce((sum, n) => sum + (n.host_count || 0), 0),
        vmCount: groupedNetworks.reduce((sum, n) => sum + (n.vm_count || 0), 0),
        siteCount: groupedNetworks.length,
      };
    }
    return {
      hostCount: network?.host_count || 0,
      vmCount: network?.vm_count || 0,
      siteCount: 1,
    };
  }, [network, groupedNetworks]);

  if (!network) {
    return (
      <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Network Details</h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Select a network to view details
        </div>
      </div>
    );
  }

  const getNetworkIcon = () => {
    return network.network_type === "distributed" ? (
      <Network className="h-5 w-5 text-primary" />
    ) : (
      <Wifi className="h-5 w-5 text-muted-foreground" />
    );
  };

  const getNetworkTypeBadge = () => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline"; label: string }> = {
      distributed: { variant: "default", label: "Distributed" },
      standard: { variant: "secondary", label: "Standard" },
      opaque: { variant: "outline", label: "Opaque" },
    };
    const config = variants[network.network_type || ""] || { variant: "outline" as const, label: network.network_type || "Unknown" };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getPowerStateBadge = (powerState: string | null) => {
    if (!powerState) return <Badge variant="outline">Unknown</Badge>;
    const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
      poweredOn: "default",
      poweredOff: "secondary",
      suspended: "outline",
    };
    const variant = variants[powerState] || "outline";
    const label = powerState.replace("powered", "").toLowerCase();
    return <Badge variant={variant}>{label}</Badge>;
  };

  // Get vCenter name for a VM
  const getVCenterName = (vcId: string | null) => {
    if (!vcId) return null;
    return vcenterMap.get(vcId) || null;
  };

  // Check if we're showing multiple sites
  const isMultiSite = groupedNetworks && groupedNetworks.length > 1 && selectedVCenterId === "all";

  return (
    <div className="w-[440px] border-l bg-card flex-shrink-0 h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          {getNetworkIcon()}
          <h2 className="text-lg font-semibold truncate">{network.name}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Network Information */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Network Information</h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                {getNetworkTypeBadge()}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">VLAN</p>
                <p className="text-sm font-mono">
                  {network.vlan_range || network.vlan_id || "—"}
                </p>
              </div>
              {network.parent_switch_name && (
                <div>
                  <p className="text-xs text-muted-foreground">Parent Switch</p>
                  <p className="text-sm">{network.parent_switch_name}</p>
                </div>
              )}
              {groupedNetworks && groupedNetworks.length > 1 ? (
                <div>
                  <p className="text-xs text-muted-foreground">Sites</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {groupedNetworks.map(n => {
                      const siteName = getVCenterName(n.source_vcenter_id);
                      return siteName ? (
                        <Badge key={n.id} variant="secondary" className="text-xs gap-1">
                          <MapPin className="h-2.5 w-2.5" />
                          {siteName}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>
              ) : vcenterName ? (
                <div>
                  <p className="text-xs text-muted-foreground">vCenter</p>
                  <p className="text-sm">{vcenterName}</p>
                </div>
              ) : null}
            </div>
          </div>

          <Separator />

          {/* Usage Stats */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Usage</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Hosts</p>
                  <p className="text-sm font-medium">{totalStats.hostCount}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">VMs</p>
                  <p className="text-sm font-medium">{totalStats.vmCount}</p>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Connected VMs */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Connected VMs ({vms.length})
              {selectedVCenterId && selectedVCenterId !== "all" && (
                <span className="text-xs font-normal ml-1">(filtered)</span>
              )}
            </h3>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-sm text-destructive py-4">{error}</div>
            ) : vms.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">
                No VMs connected to this network
              </div>
            ) : (
              <div className="space-y-2">
                {vms.map((networkVm) => {
                  const vmSiteName = isMultiSite ? getVCenterName(networkVm.source_vcenter_id) : null;
                  
                  return (
                    <div
                      key={networkVm.id}
                      className="p-3 rounded-lg border bg-muted/30 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate flex-1">
                          {networkVm.vm?.name || "Unknown VM"}
                        </span>
                        {getPowerStateBadge(networkVm.vm?.power_state || null)}
                      </div>
                      
                      <div className="space-y-1.5 text-xs">
                        {vmSiteName && (
                          <div className="flex justify-between gap-2 items-center">
                            <span className="text-muted-foreground">Site</span>
                            <Badge variant="outline" className="text-xs py-0 px-1.5 gap-1">
                              <MapPin className="h-2.5 w-2.5" />
                              {vmSiteName}
                            </Badge>
                          </div>
                        )}
                        {networkVm.nic_label && (
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">NIC</span>
                            <span className="text-right">{networkVm.nic_label}</span>
                          </div>
                        )}
                        {networkVm.mac_address && (
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">MAC</span>
                            <span className="font-mono text-right">{networkVm.mac_address}</span>
                          </div>
                        )}
                        {networkVm.adapter_type && (
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Type</span>
                            <span className="text-right">{networkVm.adapter_type.replace("Virtual", "")}</span>
                          </div>
                        )}
                        {networkVm.connected !== null && (
                          <div className="flex justify-between gap-2 items-center">
                            <span className="text-muted-foreground">Status</span>
                            <Badge variant={networkVm.connected ? "default" : "secondary"} className="text-xs py-0 px-1.5">
                              {networkVm.connected ? "Connected" : "Disconnected"}
                            </Badge>
                          </div>
                        )}
                        {networkVm.ip_addresses && networkVm.ip_addresses.length > 0 && (
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">IPs</span>
                            <span className="font-mono text-right">
                              {networkVm.ip_addresses.slice(0, 2).join(", ")}
                              {networkVm.ip_addresses.length > 2 && ` +${networkVm.ip_addresses.length - 2}`}
                            </span>
                          </div>
                        )}
                        {networkVm.vm?.cluster_name && (
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Cluster</span>
                            <span className="text-right">{networkVm.vm.cluster_name}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
