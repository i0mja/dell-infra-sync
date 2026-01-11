import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardContent, CardHeader } from "@/components/ui/card";
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
  Zap,
  RefreshCw,
  Network,
  Settings,
  Trash2,
  Clock,
  Loader2,
  AlertCircle,
  Power,
  Info,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { OutletStateIndicator } from "./OutletStateIndicator";
import { PduStatusBadge } from "./PduStatusBadge";
import type { Pdu, PduOutlet } from "@/types/pdu";

interface PduDetailsSidebarProps {
  selectedPdu: Pdu | null;
  outlets: PduOutlet[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onSync: () => void;
  onViewOutlets: () => void;
  onViewDiagnostics?: () => void;
  isTesting?: boolean;
  isSyncing?: boolean;
}

// Status bar color based on connection status
function getStatusBarColor(status: string | null): string {
  switch (status) {
    case "online":
      return "bg-success";
    case "offline":
      return "bg-muted";
    case "error":
      return "bg-destructive";
    default:
      return "bg-muted";
  }
}

export function PduDetailsSidebar({
  selectedPdu,
  outlets,
  onClose,
  onEdit,
  onDelete,
  onTest,
  onSync,
  onViewOutlets,
  onViewDiagnostics,
  isTesting = false,
  isSyncing = false,
}: PduDetailsSidebarProps) {
  // Group outlets into rows of 8
  const outletRows: PduOutlet[][] = [];
  for (let i = 0; i < outlets.length; i += 8) {
    outletRows.push(outlets.slice(i, i + 8));
  }

  // Count outlet states
  const onCount = outlets.filter(o => o.outlet_state === "on").length;
  const offCount = outlets.filter(o => o.outlet_state === "off").length;
  const unknownCount = outlets.filter(o => !o.outlet_state || o.outlet_state === "unknown").length;

  // Check for error diagnostics
  const hasErrorDiagnostics = selectedPdu?.last_sync_diagnostics?.entries?.some(
    (e: any) => e.level === 'ERROR' || e.level === 'WARN'
  );

  // PDU Details View
  if (selectedPdu) {
    return (
      <div className="w-[440px] flex-shrink-0 border-l bg-card h-full flex flex-col overflow-hidden">
        {/* Status Bar */}
        <div className={`h-1.5 ${getStatusBarColor(selectedPdu.connection_status)}`} />

        {/* Header */}
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold truncate flex items-center gap-2">
                <Zap className="h-4 w-4 flex-shrink-0" />
                {selectedPdu.name}
              </h3>
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                <p className="font-mono">{selectedPdu.ip_address}</p>
                <p className="truncate">{selectedPdu.model || "Unknown Model"}</p>
                {selectedPdu.manufacturer && (
                  <p>{selectedPdu.manufacturer}</p>
                )}
                {/* Location info */}
                {(selectedPdu.datacenter || selectedPdu.rack_id) && (
                  <p className="flex items-center gap-1 text-muted-foreground">
                    <span>📍</span>
                    <span className="truncate">
                      {[selectedPdu.datacenter, selectedPdu.rack_id].filter(Boolean).join(" · ")}
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
            <PduStatusBadge status={selectedPdu.connection_status} />
            <Badge variant="outline" className="text-xs uppercase">
              {selectedPdu.protocol || "auto"}
            </Badge>
            {selectedPdu.firmware_version && (
              <Badge variant="secondary" className="text-xs">
                v{selectedPdu.firmware_version}
              </Badge>
            )}
          </div>
        </CardHeader>

        <Separator />

        {/* Scrollable Content */}
        <ScrollArea className="flex-1">
          <CardContent className="pt-3 pb-2 space-y-4">
            {/* Quick Action Bar */}
            <div className="flex gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8"
                      onClick={onTest}
                      disabled={isTesting}
                    >
                      {isTesting ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Network className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Test
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Test PDU connection</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8"
                      onClick={onSync}
                      disabled={isSyncing}
                    >
                      {isSyncing ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Sync
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Sync outlet status</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1 h-8"
                      onClick={onViewOutlets}
                    >
                      <Power className="mr-1.5 h-3.5 w-3.5" />
                      Control
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Control outlet power</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Error diagnostic warning */}
            {hasErrorDiagnostics && selectedPdu.connection_status === 'error' && onViewDiagnostics && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive border-destructive/50 hover:bg-destructive/10"
                onClick={onViewDiagnostics}
              >
                <AlertCircle className="mr-2 h-4 w-4" />
                View Sync Diagnostics
              </Button>
            )}

            <Separator />

            {/* Outlet Grid Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Outlets ({selectedPdu.total_outlets || outlets.length})
                </h4>
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    {onCount} On
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                    {offCount} Off
                  </span>
                  {unknownCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                      {unknownCount} ?
                    </span>
                  )}
                </div>
              </div>

              {outlets.length > 0 ? (
                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                  {outletRows.map((row, rowIndex) => (
                    <div key={rowIndex} className="flex gap-1">
                      {row.map((outlet) => (
                        <OutletStateIndicator
                          key={outlet.id}
                          state={outlet.outlet_state}
                          outletNumber={outlet.outlet_number}
                          outletName={outlet.outlet_name || undefined}
                          size="sm"
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                  <Info className="mr-2 h-4 w-4" />
                  Sync to discover outlets
                </div>
              )}
            </div>

            <Separator />

            {/* Info Section */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Details
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="p-2 rounded-md bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase">Protocol</p>
                  <p className="font-medium uppercase">{selectedPdu.protocol || "Auto"}</p>
                </div>
                <div className="p-2 rounded-md bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase">Outlets</p>
                  <p className="font-medium">{selectedPdu.total_outlets || 0}</p>
                </div>
                {selectedPdu.firmware_version && (
                  <div className="p-2 rounded-md bg-muted/30 col-span-2">
                    <p className="text-[10px] text-muted-foreground uppercase">Firmware</p>
                    <p className="font-medium">{selectedPdu.firmware_version}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Last sync info */}
            {selectedPdu.last_sync && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Last synced {formatDistanceToNow(new Date(selectedPdu.last_sync), { addSuffix: true })}
              </div>
            )}

            <Separator />

            {/* Actions Section */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Actions
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="w-full" onClick={onEdit}>
                  <Settings className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={onDelete}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </div>

            {/* Notes Section */}
            {selectedPdu.notes && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Notes
                  </h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {selectedPdu.notes}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </ScrollArea>
      </div>
    );
  }

  // Empty State
  return (
    <div className="w-[440px] flex-shrink-0 border-l bg-card h-full flex flex-col">
      <div className="h-1.5 bg-muted" />

      <CardHeader className="pb-3 pt-3">
        <h3 className="text-base font-semibold">PDU Details</h3>
        <p className="text-xs text-muted-foreground">
          Select a PDU to view details
        </p>
      </CardHeader>

      <Separator />

      <CardContent className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Zap className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No PDU selected</p>
          <p className="text-xs mt-1">Click on a PDU row to view details</p>
        </div>
      </CardContent>
    </div>
  );
}
