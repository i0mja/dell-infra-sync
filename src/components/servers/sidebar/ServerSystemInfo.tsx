import { Info, CheckCircle2 } from "lucide-react";
import type { Server } from "@/hooks/useServers";
import { CollapsibleSection } from "./CollapsibleSection";

interface ServerSystemInfoProps {
  server: Server;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value || "—"}</span>
    </div>
  );
}

export function ServerSystemInfo({ server }: ServerSystemInfoProps) {
  return (
    <CollapsibleSection icon={Info} title="System Information" defaultOpen={false}>
      <div className="space-y-1.5">
        <InfoRow label="iDRAC FW" value={server.idrac_firmware} />
        <InfoRow label="BIOS" value={server.bios_version} />
        {server.redfish_version && (
          <InfoRow label="Redfish" value={server.redfish_version} />
        )}
        {server.boot_mode && (
          <InfoRow label="Boot Mode" value={server.boot_mode} />
        )}
        {server.secure_boot && (
          <InfoRow label="Secure Boot" value={server.secure_boot} />
        )}
        {server.virtualization_enabled !== null && (
          <InfoRow 
            label="Virtualization" 
            value={
              server.virtualization_enabled ? (
                <span className="flex items-center gap-1 text-success">
                  <CheckCircle2 className="h-3 w-3" />
                  Enabled
                </span>
              ) : (
                "Disabled"
              )
            } 
          />
        )}
      </div>
    </CollapsibleSection>
  );
}
