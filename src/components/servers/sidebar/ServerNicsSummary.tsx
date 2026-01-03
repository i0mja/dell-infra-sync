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
            className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-xs"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate" title={nic.fqdd}>
                  {nic.fqdd.split(".").pop() || nic.fqdd}
                </span>
                <Badge 
                  variant={nic.link_status?.toLowerCase() === "up" ? "default" : "secondary"}
                  className="text-[10px] px-1 py-0 h-4"
                >
                  {nic.link_status || "—"}
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
            <div className="text-muted-foreground text-right flex-shrink-0">
              {nic.current_speed_mbps && formatSpeed(nic.current_speed_mbps)}
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
