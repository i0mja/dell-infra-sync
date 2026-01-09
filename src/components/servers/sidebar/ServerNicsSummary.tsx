import { Copy, Check, Network, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import type { ServerNic } from "@/hooks/useServerNics";
import { CollapsibleSection } from "./CollapsibleSection";
import { formatNicSpeed, formatNicName, formatManufacturer, formatShortModel } from "@/lib/nic-utils";

interface ServerNicsSummaryProps {
  nics: ServerNic[];
  isLoading?: boolean;
}

export function ServerNicsSummary({ nics, isLoading }: ServerNicsSummaryProps) {
  const [copiedMac, setCopiedMac] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  // Sort NICs: LinkUp first, then by speed descending, then alphabetically
  const sortedNics = [...nics].sort((a, b) => {
    // LinkUp ports first
    const aUp = a.link_status?.toLowerCase() === 'linkup' || a.link_status?.toLowerCase() === 'up';
    const bUp = b.link_status?.toLowerCase() === 'linkup' || b.link_status?.toLowerCase() === 'up';
    if (aUp && !bUp) return -1;
    if (!aUp && bUp) return 1;
    
    // Then by speed (highest first)
    const aSpeed = a.current_speed_mbps || 0;
    const bSpeed = b.current_speed_mbps || 0;
    if (aSpeed !== bSpeed) return bSpeed - aSpeed;
    
    // Finally alphabetically by FQDD
    return a.fqdd.localeCompare(b.fqdd);
  });

  // Show first 6 sorted NICs, or all if expanded
  const displayNics = showAll ? sortedNics : sortedNics.slice(0, 6);
  const hasMore = nics.length > 6;

  return (
    <CollapsibleSection 
      icon={Network} 
      title="Network Interfaces" 
      count={nics.length}
      defaultOpen={false}
    >
      <div className={`space-y-1.5 ${showAll ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>
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
                    {formatNicSpeed(nic.current_speed_mbps)}
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
              {/* Manufacturer and model line */}
              {(nic.manufacturer || formatShortModel(nic.model)) && (
                <div className="text-[10px] text-muted-foreground truncate mt-0.5" title={nic.model || ''}>
                  {formatManufacturer(nic.manufacturer)}
                  {formatManufacturer(nic.manufacturer) && formatShortModel(nic.model) && ' • '}
                  {formatShortModel(nic.model)}
                </div>
              )}
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
        
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-7 mt-1"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? (
              <>
                <ChevronUp className="h-3 w-3 mr-1" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3 mr-1" />
                View All NICs ({nics.length})
              </>
            )}
          </Button>
        )}
      </div>
    </CollapsibleSection>
  );
}
