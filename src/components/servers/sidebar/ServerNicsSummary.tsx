import { Copy, Check, Network, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import type { ServerNic } from "@/hooks/useServerNics";
import { CollapsibleSection } from "./CollapsibleSection";

interface ServerNicsSummaryProps {
  nics: ServerNic[];
  isLoading?: boolean;
  onViewAll?: () => void;
}

function formatSpeed(mbps: number | null): string {
  if (!mbps) return "";
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(0)}G`;
  }
  return `${mbps}M`;
}

function formatNicName(nic: ServerNic): string {
  const fqdd = nic.fqdd;
  
  // FC adapters: FC.Slot.1-1 → "FC Slot 1 Port 1"
  const fcMatch = fqdd.match(/FC\.Slot\.(\d+)-(\d+)/);
  if (fcMatch) {
    return `FC Slot ${fcMatch[1]} Port ${fcMatch[2]}`;
  }
  
  // Embedded NICs: NIC.Embedded.1-1-1 → "Embedded 1 Port 1"
  // These are typically dedicated management or secondary adapter NICs
  const embMatch = fqdd.match(/NIC\.Embedded\.(\d+)-(\d+)-(\d+)/);
  if (embMatch) {
    return `Embedded ${embMatch[1]} Port ${embMatch[2]}`;
  }
  
  // Integrated NICs: NIC.Integrated.1-2-1 → "LOM Port 2"
  // These are the main LAN-on-Motherboard ports
  const intMatch = fqdd.match(/NIC\.Integrated\.(\d+)-(\d+)-(\d+)/);
  if (intMatch) {
    return `LOM Port ${intMatch[2]}`;
  }
  
  // PCIe slot NICs: NIC.Slot.2-1-1 → "Slot 2 Port 1"
  const slotMatch = fqdd.match(/NIC\.Slot\.(\d+)-(\d+)/);
  if (slotMatch) {
    return `Slot ${slotMatch[1]} Port ${slotMatch[2]}`;
  }
  
  // Fallback to model or cleaned FQDD
  return nic.model || fqdd.split(".").pop() || fqdd;
}

export function ServerNicsSummary({ nics, isLoading, onViewAll }: ServerNicsSummaryProps) {
  const [copiedMac, setCopiedMac] = useState<string | null>(null);

  const copyToClipboard = async (mac: string) => {
    try {
      await navigator.clipboard.writeText(mac);
      setCopiedMac(mac);
      toast.success("MAC address copied");
      setTimeout(() => setCopiedMac(null), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  if (isLoading) {
    return (
      <CollapsibleSection icon={Network} title="Network Interfaces" count="...">
        <div className="text-xs text-muted-foreground animate-pulse">Loading NICs...</div>
      </CollapsibleSection>
    );
  }

  if (!nics || nics.length === 0) {
    return (
      <CollapsibleSection icon={Network} title="Network Interfaces" count="0">
        <div className="text-xs text-muted-foreground">
          No NIC data available. Run a server refresh to collect network information.
        </div>
      </CollapsibleSection>
    );
  }

  // Show first 6 NICs, with option to view all
  const displayNics = nics.slice(0, 6);
  const hasMore = nics.length > 6;

  return (
    <CollapsibleSection 
      icon={Network} 
      title="Network Interfaces" 
      count={nics.length}
      defaultOpen={false}
    >
      <div className="space-y-1.5">
        {displayNics.map((nic) => (
          <div
            key={nic.id}
            className="flex items-start gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-xs"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate" title={nic.model || nic.fqdd}>
                  {formatNicName(nic)}
                </span>
                {nic.current_speed_mbps != null && nic.current_speed_mbps > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-normal">
                    {formatSpeed(nic.current_speed_mbps)}
                  </Badge>
                )}
                <Badge 
                  variant={
                    nic.link_status?.toLowerCase() === "up" || nic.link_status?.toLowerCase() === "linkup"
                      ? "default" 
                      : nic.link_status?.toLowerCase() === "down" || nic.link_status?.toLowerCase() === "linkdown"
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-[10px] px-1 py-0 h-4"
                >
                  {nic.link_status === "LinkUp" || nic.link_status?.toLowerCase() === "up" ? "Up" : 
                   nic.link_status === "LinkDown" || nic.link_status?.toLowerCase() === "down" ? "Down" : 
                   nic.link_status || "Unknown"}
                </Badge>
              </div>
              {nic.mac_address && (
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="font-mono text-muted-foreground text-[10px]">
                    {nic.mac_address}
                  </span>
                  <button
                    onClick={() => copyToClipboard(nic.mac_address!)}
                    className="p-0.5 rounded hover:bg-muted transition-colors"
                    title="Copy MAC address"
                  >
                    {copiedMac === nic.mac_address ? (
                      <Check className="h-3 w-3 text-success" />
                    ) : (
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        
        {(hasMore || onViewAll) && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-7 mt-1"
            onClick={onViewAll}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View All NICs
          </Button>
        )}
      </div>
    </CollapsibleSection>
  );
}
