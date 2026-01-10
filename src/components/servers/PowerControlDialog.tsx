import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Power, Square, RefreshCw, AlertTriangle, Plug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { logActivityDirect } from "@/hooks/useActivityLog";
import { useServerPduMappings } from "@/hooks/useServerPduMappings";
import { ServerPduPowerSection } from "@/components/pdu/ServerPduPowerSection";
import { ServerPduMappingDialog } from "@/components/pdu/ServerPduMappingDialog";
import type { Server } from "@/hooks/useServers";

interface PowerControlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    ip_address: string;
    hostname?: string | null;
    power_state?: string | null;
  };
}

export function PowerControlDialog({ open, onOpenChange, server }: PowerControlDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  
  const { mappings } = useServerPduMappings(server.id);
  const hasPduMappings = mappings.length > 0;

  const handlePowerAction = async (action: string) => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'power_action',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { action }
        });

      if (jobError) throw jobError;

      // Log activity
      logActivityDirect('power_action', 'server', server.hostname || server.ip_address, { action }, { targetId: server.id, success: true });
      
      toast.success(`Power action initiated: ${action}`);
    } catch (error: any) {
      console.error('Error creating power action job:', error);
      toast.error('Failed to initiate power action', {
        description: error.message
      });

      // Log failed activity
      logActivityDirect('power_action', 'server', server.hostname || server.ip_address, { action }, { targetId: server.id, success: false, error: error.message });
    } finally {
      setIsSubmitting(false);
      setConfirmAction(null);
    }
  };

  const destructiveActions = ['ForceOff', 'ForceRestart'];
  const requiresConfirmation = (action: string) => destructiveActions.includes(action);

  const handleActionClick = (action: string) => {
    if (requiresConfirmation(action)) {
      setConfirmAction(action);
    } else {
      handlePowerAction(action);
    }
  };

  const getPowerStateColor = (state?: string | null) => {
    if (!state) return "secondary";
    return state === "On" ? "default" : "outline";
  };

  // Create a minimal Server object for the mapping dialog
  const serverForMapping: Server = {
    id: server.id,
    ip_address: server.ip_address,
    hostname: server.hostname || null,
    idrac_hostname: null,
    model: null,
    service_tag: null,
    manufacturer: null,
    product_name: null,
    idrac_firmware: null,
    bios_version: null,
    redfish_version: null,
    cpu_count: null,
    memory_gb: null,
    manager_mac_address: null,
    supported_endpoints: null,
    discovery_job_id: null,
    connection_status: null,
    connection_error: null,
    credential_test_status: null,
    credential_last_tested: null,
    last_connection_test: null,
    power_state: server.power_state || null,
    overall_health: null,
    last_health_check: null,
    vcenter_host_id: null,
    credential_set_id: null,
    last_seen: null,
    created_at: '',
    notes: null,
    cpu_model: null,
    cpu_cores_per_socket: null,
    cpu_speed: null,
    boot_mode: null,
    boot_order: null,
    secure_boot: null,
    virtualization_enabled: null,
    total_drives: null,
    total_storage_tb: null,
    datacenter: null,
    rack_id: null,
    rack_position: null,
    row_aisle: null,
    room_floor: null,
    location_notes: null,
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Power className="h-5 w-5" />
              Power Control
            </DialogTitle>
            <DialogDescription>
              Execute power actions on {server.hostname || server.ip_address}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Current Power State */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
              <span className="text-sm font-medium">Current Power State:</span>
              <Badge variant={getPowerStateColor(server.power_state)}>
                {server.power_state || 'Unknown'}
              </Badge>
            </div>

            {/* iDRAC Power Actions */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium mb-3">iDRAC Power Actions</h4>
              
              <Button
                onClick={() => handleActionClick('On')}
                disabled={isSubmitting}
                className="w-full justify-start"
                variant="outline"
              >
                <Power className="h-4 w-4 mr-2" />
                Power On
              </Button>

              <Button
                onClick={() => handleActionClick('GracefulShutdown')}
                disabled={isSubmitting}
                className="w-full justify-start"
                variant="outline"
              >
                <Square className="h-4 w-4 mr-2" />
                Graceful Shutdown
              </Button>

              <Button
                onClick={() => handleActionClick('ForceRestart')}
                disabled={isSubmitting}
                className="w-full justify-start"
                variant="outline"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Force Restart
              </Button>

              <Button
                onClick={() => handleActionClick('ForceOff')}
                disabled={isSubmitting}
                className="w-full justify-start"
                variant="destructive"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Force Power Off
              </Button>
            </div>

            <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/30">
              <p><strong>Note:</strong> Force actions may cause data loss. Use graceful shutdown when possible.</p>
            </div>

            {/* PDU Power Control Section */}
            <Separator />
            
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Plug className="h-4 w-4" />
                <h4 className="text-sm font-medium">PDU Power Control</h4>
                {hasPduMappings && (
                  <Badge variant="outline" className="text-xs">
                    {mappings.length} {mappings.length === 1 ? 'feed' : 'feeds'}
                  </Badge>
                )}
              </div>
              
              <ServerPduPowerSection
                serverId={server.id}
                serverName={server.hostname || server.ip_address}
                onManageMappings={() => setShowMappingDialog(true)}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Destructive Actions */}
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {confirmAction}</AlertDialogTitle>
            <AlertDialogDescription>
              This is a destructive action that may cause data loss or service interruption.
              Are you sure you want to {confirmAction === 'ForceOff' ? 'force power off' : 'force restart'} {server.hostname || server.ip_address}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && handlePowerAction(confirmAction)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm {confirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PDU Mapping Dialog */}
      <ServerPduMappingDialog
        open={showMappingDialog}
        onOpenChange={setShowMappingDialog}
        server={serverForMapping}
      />
    </>
  );
}
